import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

import { encryptWithRawKey, decryptWithRawKey, type AeadEnvelope } from "../vault/vault-crypto";
import { getSessionVaultKey } from "../vault/vault-manager";
import type { SignedLicense, LicenseType, ActivationStatus } from "../license/schema";

// ===================================================================
// License Database
//
// Sensitive fields (customer, company, machine fingerprint, notes,
// and the full signed license payload) are stored as a single
// AES-256-GCM blob per row, encrypted with the vault key. Only
// license_id, status, license_type, and timestamps stay in plaintext
// columns, since they're needed for indexing/dashboard counts and are
// not sensitive on their own. Copying database.sqlite off this
// machine without the vault key/password/recovery key does not expose
// customer data or license payloads.
//
// The database lives in app.getPath("userData") — an explicit,
// predictable, non-temporary location.
// ===================================================================

let db: Database.Database | null = null;

function dbPath(): string {
  return path.join(app.getPath("userData"), "licenses.sqlite");
}

function getDb(): Database.Database {

  if (db) return db;

  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      license_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      license_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      relationship TEXT NOT NULL,
      supersedes_license_id TEXT,
      blob_salt TEXT,
      blob_iv TEXT NOT NULL,
      blob_tag TEXT NOT NULL,
      blob_ciphertext TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id TEXT NOT NULL,
      event TEXT NOT NULL,
      at TEXT NOT NULL,
      detail TEXT
    );
  `);

  return db;

}

export interface LicenseRecordBlob {
  customerName: string;
  companyName: string;
  machineFingerprint: string;
  notes: string;
  signedLicense: SignedLicense;
}

export interface LicenseRecord {
  licenseId: string;
  /** Effective lifecycle status. Revocation is authoritative; otherwise expiry is derived from the signed payload. */
  status: ActivationStatus;
  licenseType: LicenseType;
  createdAt: string;
  updatedAt: string;
  relationship: string;
  supersedesLicenseId: string | null;
  data: LicenseRecordBlob;
}

function encryptBlob(data: LicenseRecordBlob): AeadEnvelope {
  const key = getSessionVaultKey();
  return encryptWithRawKey(Buffer.from(JSON.stringify(data), "utf8"), key);
}

function decryptBlob(envelope: AeadEnvelope): LicenseRecordBlob | null {
  const key = getSessionVaultKey();
  const raw = decryptWithRawKey(envelope, key);
  if (!raw) throw new Error("License database integrity check failed.");
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("License database record is corrupted.");
  }
}

export function insertLicense(
  licenseId: string,
  status: ActivationStatus,
  licenseType: LicenseType,
  relationship: string,
  supersedesLicenseId: string | null,
  data: LicenseRecordBlob
): void {

  const now = new Date().toISOString();
  const envelope = encryptBlob(data);

  getDb()
    .prepare(
      `INSERT INTO licenses
        (license_id, status, license_type, created_at, updated_at, relationship, supersedes_license_id, blob_salt, blob_iv, blob_tag, blob_ciphertext)
       VALUES (@license_id, @status, @license_type, @created_at, @updated_at, @relationship, @supersedes_license_id, @blob_salt, @blob_iv, @blob_tag, @blob_ciphertext)`
    )
    .run({
      license_id: licenseId,
      status,
      license_type: licenseType,
      created_at: now,
      updated_at: now,
      relationship,
      supersedes_license_id: supersedesLicenseId,
      blob_salt: envelope.saltB64,
      blob_iv: envelope.ivB64,
      blob_tag: envelope.tagB64,
      blob_ciphertext: envelope.ciphertextB64
    });

  addAuditEntry(licenseId, "created", relationship);

}

function rowToRecord(row: any): LicenseRecord | null {

  const data = decryptBlob({
    saltB64: row.blob_salt ?? "",
    ivB64: row.blob_iv,
    tagB64: row.blob_tag,
    ciphertextB64: row.blob_ciphertext
  });

  if (!data) return null;

  const expiration = data.signedLicense.payload.expirationDate;
  const effectiveStatus: ActivationStatus =
    row.status === "revoked"
      ? "revoked"
      : expiration && Date.parse(expiration) <= Date.now()
        ? "expired"
        : row.status;

  return {
    licenseId: row.license_id,
    status: effectiveStatus,
    licenseType: row.license_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    relationship: row.relationship,
    supersedesLicenseId: row.supersedes_license_id,
    data
  };

}

export function getLicenseById(licenseId: string): LicenseRecord | null {
  const row = getDb().prepare(`SELECT * FROM licenses WHERE license_id = ?`).get(licenseId);
  return row ? rowToRecord(row) : null;
}

export function listAllLicenses(): LicenseRecord[] {
  const rows = getDb().prepare(`SELECT * FROM licenses ORDER BY created_at DESC`).all();
  return rows.map(rowToRecord) as LicenseRecord[];
}

/** In-memory search across decrypted fields — acceptable at license-DB scale. */
export function searchLicenses(query: string): LicenseRecord[] {

  const q = query.trim().toLowerCase();
  if (!q) return listAllLicenses();

  const normalizedCodeQuery = q.replace(/[^a-z0-9]/g, "");

  return listAllLicenses().filter((r) => {
    const activationCode = r.data.signedLicense.payload.activationCode ?? "";
    return (
      r.licenseId.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q) ||
      r.licenseType.toLowerCase().includes(q) ||
      r.data.customerName.toLowerCase().includes(q) ||
      r.data.companyName.toLowerCase().includes(q) ||
      r.data.machineFingerprint.toLowerCase().includes(q) ||
      activationCode.toLowerCase().includes(q) ||
      activationCode.toLowerCase().replace(/[^a-z0-9]/g, "").includes(normalizedCodeQuery)
    );
  });

}

export function updateLicenseStatus(licenseId: string, status: ActivationStatus, event: string, detail?: string): void {

  const database = getDb();
  const transaction = database.transaction(() => {
    const result = database
      .prepare(`UPDATE licenses SET status = @status, updated_at = @updated_at WHERE license_id = @license_id`)
      .run({ status, updated_at: new Date().toISOString(), license_id: licenseId });

    if (result.changes !== 1) {
      throw new Error("License not found.");
    }

    database
      .prepare(`INSERT INTO audit_log (license_id, event, at, detail) VALUES (?, ?, ?, ?)`)
      .run(licenseId, event, new Date().toISOString(), detail ?? null);
  });

  transaction();

}

export function addAuditEntry(licenseId: string, event: string, detail?: string): void {

  getDb()
    .prepare(`INSERT INTO audit_log (license_id, event, at, detail) VALUES (?, ?, ?, ?)`)
    .run(licenseId, event, new Date().toISOString(), detail ?? null);

}

export function getAuditHistory(licenseId: string): { event: string; at: string; detail: string | null }[] {

  return getDb()
    .prepare(`SELECT event, at, detail FROM audit_log WHERE license_id = ? ORDER BY at ASC`)
    .all(licenseId) as any;

}

export function getDashboardCounts(): { total: number; active: number; expired: number; revoked: number } {

  const all = listAllLicenses();
  let active = 0;
  let expired = 0;
  let revoked = 0;

  for (const r of all) {
    if (r.status === "revoked") revoked++;
    else if (r.status === "expired") expired++;
    else active++;
  }

  return { total: all.length, active, expired, revoked };

}

// ===================================================================
// Backup / Reset
//
// The database only ever stores AES-256-GCM-encrypted blobs of
// customer/license data (see encryptBlob above) — license_id, status,
// license_type, and timestamps are the only plaintext columns, and
// those aren't sensitive on their own. A raw backup of licenses.sqlite
// is therefore safe to hand to the user; it decrypts only with this
// Generator's vault key, exactly like the live database.
//
// Reset only clears license/audit rows. It never touches vault.json
// (master password/recovery) or signing-key.json (the Ed25519 private
// key) — those must survive a reset, since every license already
// issued to a customer was signed with that key and must keep
// verifying in MBS even if the Generator's local record of it is gone.
// ===================================================================

/**
 * Uses SQLite's online backup API (via better-sqlite3) so an
 * in-progress WAL write can never produce a torn/inconsistent backup
 * file. Returns the destination path on success.
 */
export async function backupDatabaseTo(destinationPath: string): Promise<string> {

  const database = getDb();

  // Write a complete backup to a side file first, then swap it in. Deleting
  // the destination up front (as this used to) destroyed the previous backup
  // even if the new one then failed halfway.
  const partialPath = `${destinationPath}.partial-${process.pid}-${Date.now()}`;

  try {
    await database.backup(partialPath);
    if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
    fs.renameSync(partialPath, destinationPath);
  } catch (error) {
    if (fs.existsSync(partialPath)) {
      try { fs.unlinkSync(partialPath); } catch { /* best effort cleanup */ }
    }
    throw error;
  }

  return destinationPath;

}

/**
 * Restores licenses.sqlite from a backup produced by backupDatabaseTo().
 *
 * Before touching the live database, opens the candidate file read-only
 * and confirms every row decrypts with *this* Generator's current vault
 * key. A backup made under a different vault instance (different
 * machine, different vault.json) would otherwise look like a valid
 * SQLite file but leave every row permanently unreadable once swapped
 * in — so that case is rejected up front instead of silently bricking
 * the live database.
 */
export async function restoreDatabaseFrom(sourcePath: string): Promise<{ licensesRestored: number }> {

  if (!fs.existsSync(sourcePath)) {
    throw new Error("Backup file not found.");
  }

  const target = dbPath();

  // Restoring "from" the live database would delete it and then try to copy
  // the (now deleted) source over itself, leaving no database at all. The
  // file picker starts in Documents, but users can browse to the userData
  // folder, so this is a reachable mistake, not a theoretical one.
  const resolvesToLiveDatabase = (() => {
    try {
      return fs.realpathSync(sourcePath) === fs.realpathSync(target);
    } catch {
      return path.resolve(sourcePath) === path.resolve(target);
    }
  })();

  if (resolvesToLiveDatabase) {
    throw new Error("That is the live license database, not a backup file. Choose a backup made with Backup database.");
  }

  let candidate: Database.Database;
  try {
    candidate = new Database(sourcePath, { readonly: true, fileMustExist: true });
  } catch {
    throw new Error("Selected file is not a valid SQLite database.");
  }

  let rows: any[];
  try {
    rows = candidate.prepare(`SELECT * FROM licenses`).all();
  } catch {
    candidate.close();
    throw new Error("Selected file does not look like a Generator database backup.");
  }

  for (const row of rows) {
    try {
      const data = decryptBlob({
        saltB64: row.blob_salt ?? "",
        ivB64: row.blob_iv,
        tagB64: row.blob_tag,
        ciphertextB64: row.blob_ciphertext
      });
      if (!data) throw new Error("empty");
    } catch {
      candidate.close();
      throw new Error("This backup can't be decrypted by this Generator's vault, so it was not restored.");
    }
  }

  const licensesRestored = rows.length;
  candidate.close();

  // Close the live handle before replacing files on disk.
  if (db) {
    db.close();
    db = null;
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    const p = target + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  fs.copyFileSync(sourcePath, target);

  // Reopen so subsequent calls (and the renderer's next refresh) see
  // the restored data immediately.
  getDb();

  return { licensesRestored };

}

/** Deletes all license and audit records. Signing key and vault are untouched. */
export function resetDatabase(): { licensesRemoved: number } {

  const database = getDb();
  const countBefore = (database.prepare(`SELECT COUNT(*) AS c FROM licenses`).get() as { c: number }).c;

  const clear = database.transaction(() => {
    database.prepare(`DELETE FROM audit_log`).run();
    database.prepare(`DELETE FROM licenses`).run();
  });
  clear();

  // Reclaim disk space and fold the WAL back into the main file now
  // that the tables are empty. VACUUM cannot run inside a transaction,
  // so this happens after `clear()` has committed.
  database.pragma("wal_checkpoint(TRUNCATE)");
  database.exec("VACUUM");

  return { licensesRemoved: countBefore };

}
