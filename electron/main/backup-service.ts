import fs from "node:fs";
import path from "node:path";

import {
  getDatabase,
  getDatabaseFilePath,
  closeDatabase
} from "../../src/database/database";

// ===================================================================
// Backup & Restore — Database Settings module
//
// Backups are plain copies of the live SQLite file, produced through
// better-sqlite3's built-in `.backup()` (an online/hot backup that is
// safe to run while the database is in active use -- it does not
// require closing the connection). Restore is destructive by nature
// (it replaces the on-disk file the app is actively reading/writing),
// so it always takes an automatic safety copy of the current database
// first, then closes the live connection before swapping the file so
// the next getDatabase() call re-opens the restored file cleanly.
// ===================================================================

const SQLITE_HEADER = "SQLite format 3\0";

export interface DatabaseInfo {
  path: string;
  sizeBytes: number;
  lastModified: string | null;
  tableCounts: Record<string, number>;
}

export interface BackupResult {
  success: boolean;
  filePath?: string;
  cancelled?: boolean;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  safetyBackupPath?: string;
}

export interface IntegrityResult {
  success: boolean;
  ok: boolean;
  detail: string;
  error?: string;
  // Non-destructive: PRAGMA foreign_key_check reports existing FK
  // violations without touching any data (see checkDatabaseIntegrity()
  // below for why this exists -- enabling foreign_keys enforcement,
  // done in a previous fix, only blocks FUTURE bad writes; it cannot
  // and does not retroactively fix or delete anything already on disk).
  foreignKeyViolations?: Array<{ table: string; rowId: number | null; referencedTable: string }>;
}

/**
 * Reads the tables that exist across the whole app (not just
 * Certificates) so the Database Settings page can show a meaningful
 * snapshot of what a backup actually contains.
 */
const SUMMARY_TABLES = [
  "products",
  "customers",
  "orders",
  "invoices",
  "certificates",
  "transactions",
  "inventory_transactions"
] as const;

export function getDatabaseInfo(): DatabaseInfo {

  const db = getDatabase();
  const dbPath = getDatabaseFilePath();

  let sizeBytes = 0;
  let lastModified: string | null = null;

  try {

    const stats = fs.statSync(dbPath);
    sizeBytes = stats.size;
    lastModified = stats.mtime.toISOString();

  }
  catch (error) {

    console.error("Failed to read database file stats", error);

  }

  const tableCounts: Record<string, number> = {};

  for (const table of SUMMARY_TABLES) {

    try {

      const row = db
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number };

      tableCounts[table] = row.count;

    }
    catch (error) {

      // A missing table shouldn't break the whole info panel -- just
      // omit it from the summary.
      console.error(`Failed to count rows in ${table}`, error);

    }

  }

  return {
    path: dbPath,
    sizeBytes,
    lastModified,
    tableCounts
  };

}

/**
 * Performs a hot/online backup of the live database to the given
 * destination path using better-sqlite3's built-in `.backup()` API.
 * Safe to call while the app is in normal use.
 */
export async function createBackup(destinationPath: string): Promise<BackupResult> {

  try {

    const dbPath = getDatabaseFilePath();

    if (path.resolve(destinationPath) === path.resolve(dbPath)) {

      return {
        success: false,
        error: "Backup destination cannot be the active database file. Please choose a different file name or location."
      };

    }

    const db = getDatabase();

    await db.backup(destinationPath);

    return { success: true, filePath: destinationPath };

  }
  catch (error) {

    console.error("DATABASE BACKUP FAILED", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };

  }

}

/**
 * Validates that a file looks like a genuine SQLite database before
 * it is ever used to overwrite the live one -- guards against a
 * corrupted download, a renamed unrelated file, etc.
 */
function isValidSqliteFile(filePath: string): boolean {

  try {

    const fd = fs.openSync(filePath, "r");

    const buffer = Buffer.alloc(SQLITE_HEADER.length);

    fs.readSync(fd, buffer, 0, SQLITE_HEADER.length, 0);

    fs.closeSync(fd);

    return buffer.toString("utf-8") === SQLITE_HEADER;

  }
  catch (error) {

    console.error("Failed to validate SQLite file header", error);

    return false;

  }

}

/**
 * Restores the database from a previously created backup file.
 *
 * Steps (in order, each one only runs if the previous one succeeded):
 *  1. Reject the source file if it doesn't exist, is the live
 *     database file itself, or doesn't look like a real SQLite file.
 *  2. Take an automatic safety backup of the *current* database, so a
 *     restore can never permanently destroy data even by mistake.
 *  3. Close the live connection so the file on disk is free to
 *     overwrite.
 *  4. Copy the chosen backup into a temp file and atomically rename
 *     it over the live database file, so a failure partway through
 *     never leaves a truncated/corrupted database behind.
 *
 * The caller (IPC handler in main.ts) is responsible for relaunching
 * the app afterwards -- every repository in the app holds/derives its
 * connection through getDatabase(), and a clean relaunch is the
 * simplest way to guarantee every open window and cached statement is
 * reset against the newly restored file.
 */
export async function restoreFromBackup(sourcePath: string): Promise<RestoreResult> {

  try {

    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: "Selected backup file does not exist." };
    }

    const dbPath = getDatabaseFilePath();

    if (path.resolve(sourcePath) === path.resolve(dbPath)) {

      return {
        success: false,
        error: "The selected file is the active database itself. Please choose a different backup file to restore from."
      };

    }

    if (!isValidSqliteFile(sourcePath)) {
      return { success: false, error: "Selected file is not a valid SQLite database." };
    }

    // Step 2: safety backup of the current (pre-restore) database.
    const backupsDir = path.join(path.dirname(dbPath), "backups");

    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safetyBackupPath = path.join(backupsDir, `pre-restore-${timestamp}.db`);

    const safetyBackup = await createBackup(safetyBackupPath);

    if (!safetyBackup.success) {

      return {
        success: false,
        error: `Restore aborted: could not create a safety backup first (${safetyBackup.error ?? "unknown error"}).`
      };

    }

    // Step 3: release the live handle.
    closeDatabase();

    // Step 4: copy the chosen backup into a temp file *next to* the
    // live database, then atomically rename it into place. Writing
    // directly on top of the live file (a plain copyFileSync onto
    // dbPath) would leave a truncated, unopenable database if the
    // copy were interrupted partway (disk full, permission error,
    // power loss). rename() on the same volume is atomic on both
    // POSIX and Windows, so the live file is either the old one or
    // the fully-restored one -- never a partial write.
    const tempPath = `${dbPath}.restore-tmp`;

    try {

      fs.copyFileSync(sourcePath, tempPath);
      fs.renameSync(tempPath, dbPath);

    }
    catch (copyError) {

      // Best-effort cleanup of the temp file; the live database file
      // was never touched, so this failure is fully recoverable and
      // the safety backup made above is untouched too.
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }
      catch {
        // Ignore cleanup failure; nothing more we can safely do.
      }

      throw copyError;

    }

    return { success: true, safetyBackupPath };

  }
  catch (error) {

    console.error("DATABASE RESTORE FAILED", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };

  }

}

/**
 * Reclaims unused space and defragments the database file. Safe to
 * run at any time; can take a few seconds on a large database.
 */
export function vacuumDatabase(): { success: boolean; error?: string } {

  try {

    getDatabase().exec("VACUUM");

    return { success: true };

  }
  catch (error) {

    console.error("DATABASE VACUUM FAILED", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };

  }

}

/**
 * Runs SQLite's built-in integrity check and reports whether the
 * database file is structurally sound. Also runs PRAGMA foreign_key_check
 * (added during a database-integrity audit that found employee_contracts'
 * FOREIGN KEY constraints had never actually been enforced -- see the
 * comment on `db.pragma("foreign_keys = ON")` in src/database/database.ts).
 * That fix only prevents FUTURE bad writes; it cannot retroactively
 * validate or repair rows already on disk from before the fix shipped.
 * This reports any pre-existing violations explicitly, non-destructively
 * -- nothing here deletes or modifies a single row. Per the audit's own
 * rule ("identify explicitly and add a safe check rather than silently
 * deleting records"), fixing any violation this surfaces is a decision
 * for a person (or a dedicated, reviewed repair path), not something to
 * guess at silently here.
 */
export function checkDatabaseIntegrity(): IntegrityResult {

  try {

    const db = getDatabase();

    const row = db
      .prepare("PRAGMA integrity_check")
      .get() as { integrity_check: string };

    const detail = row.integrity_check;

    const fkRows = db.prepare("PRAGMA foreign_key_check").all() as Array<{ table: string; rowid: number | null; parent: string; fkid: number }>;
    const foreignKeyViolations = fkRows.map(r => ({ table: r.table, rowId: r.rowid, referencedTable: r.parent }));

    return {
      success: true,
      ok: detail === "ok" && foreignKeyViolations.length === 0,
      detail,
      foreignKeyViolations
    };

  }
  catch (error) {

    console.error("DATABASE INTEGRITY CHECK FAILED", error);

    return {
      success: false,
      ok: false,
      detail: "",
      error: error instanceof Error ? error.message : "Unknown error"
    };

  }

}
