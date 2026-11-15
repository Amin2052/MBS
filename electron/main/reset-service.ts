import { getDatabase } from "../../src/database/database";

// ===================================================================
// ERP Reset / Factory Reset
//
// Two distinct, Owner-only destructive operations (per spec, kept
// separate rather than merged into one flag):
//
// - ERP Reset: clears all *business* data (products, customers,
//   orders, invoices, employees, certificates, transactions,
//   inventory movements, notifications) but keeps the Owner account,
//   Administrator/Employee accounts, permission profiles, Business
//   Mode, company profile, and license intact. For "start this
//   business's records over" without losing who can log in or how the
//   company is configured.
//
// - Factory Reset: everything ERP Reset clears, PLUS every user
//   account (Owner included), all sessions, and all permission
//   profiles/assignments, and resets company_settings (including
//   Business Mode) back to defaults. This is what makes the
//   First-Time Setup Wizard reappear on next launch, matching the
//   Phase 1 spec note: "must never appear again unless a Factory
//   Reset has been performed." License data is deliberately left
//   untouched -- a license is tied to the purchase, not to the
//   business's data or accounts.
//
// Both run inside a single transaction (all-or-nothing) and the
// caller (main.ts) is responsible for relaunching the app afterward,
// exactly like restoreFromBackup's existing relaunch pattern.
// ===================================================================

const BUSINESS_DATA_TABLES = [
  "notifications",
  "inventory_transactions",
  "transactions",
  "certificates",
  "invoices",
  "orders",
  "employee_contracts",
  "employees",
  "customers",
  "products"
] as const;

// SAFETY (found this session, while auditing reset alongside the new
// bidirectional cloud sync engine -- see cloud-sync-manager.ts):
// deleting rows from BUSINESS_DATA_TABLES without ALSO clearing their
// cloud_sync_map/sync_cursor/sync_offline_queue entries would be a real,
// severe data-safety bug on any cloud-synced installation, not a
// theoretical one. SQLite's AUTOINCREMENT never reuses row ids, so
// every mapping left behind after a reset points at a row that
// genuinely, permanently no longer exists locally. cloud-sync-manager.ts's
// syncTable() explicitly treats "a mapped row that no longer exists
// locally" as "the user deleted this record, push a DELETE to the
// cloud" -- which is the CORRECT behavior for a real, single-record
// delete, but on a reset it would misinterpret the ENTIRE wiped table as
// thousands of individual deletes and push all of them, silently
// propagating the reset to every OTHER device synced to the same
// company workspace on their next sync. Clearing these three tables
// (scoped to just the business-data tables being reset) makes the sync
// engine correctly forget it ever synced any of this, instead of
// mistaking a local wipe for a wave of real deletions.
const SYNC_TABLE_NAMES_TO_CLEAR = BUSINESS_DATA_TABLES;

function clearSyncStateFor(db: ReturnType<typeof getDatabase>, tables: readonly string[]): void {
  const placeholders = tables.map(() => "?").join(",");
  db.prepare(`DELETE FROM cloud_sync_map WHERE table_name IN (${placeholders})`).run(...tables);
  db.prepare(`DELETE FROM sync_cursor WHERE table_name IN (${placeholders})`).run(...tables);
  db.prepare(`DELETE FROM sync_offline_queue WHERE collection IN (${placeholders})`).run(...tables);
}

export interface ResetResult {
  success: boolean;
  error?: string;
}

/** Table names a reset clears. Exported so the cloud-reset service and the
 *  reset preview report exactly the same set the local reset deletes --
 *  one list, not two that can drift apart. */
export const RESET_BUSINESS_TABLES = BUSINESS_DATA_TABLES;

/** Row counts for the reset preview (local side). */
export function countLocalBusinessRows(): Record<string, number> {
  const db = getDatabase();
  const counts: Record<string, number> = {};
  for (const table of BUSINESS_DATA_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
    counts[table] = Number(row?.n || 0);
  }
  return counts;
}

/** Wipes this device's business records without touching logins,
 *  permissions, company settings or the license. This is what a CENTRAL
 *  reset leaves behind on the owner's machine, and what a second device
 *  does when it discovers the central epoch moved: the cloud is now the
 *  source of truth, so holding on to local copies would be exactly the
 *  stale data the epoch exists to prevent from returning. */
export function clearLocalBusinessData(): ResetResult {
  const db = getDatabase();
  try {
    const transaction = db.transaction(() => {
      for (const table of BUSINESS_DATA_TABLES) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      clearSyncStateFor(db, SYNC_TABLE_NAMES_TO_CLEAR);
    });
    transaction();
    return { success: true };
  } catch (error) {
    console.error("LOCAL BUSINESS CLEAR FAILED", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error clearing local business data." };
  }
}

/** Clears ALL sync bookkeeping, not just the business tables' entries.
 *  Used when re-baselining after a central reset: any mapping, cursor or
 *  queued operation from before the reset describes a world that no longer
 *  exists, and replaying the queue would recreate deleted records. */
export function clearAllSyncBookkeeping(): void {
  const db = getDatabase();
  db.prepare("DELETE FROM cloud_sync_map").run();
  db.prepare("DELETE FROM sync_cursor").run();
  db.prepare("DELETE FROM sync_offline_queue").run();
}

export function performErpReset(): ResetResult {

  const db = getDatabase();

  try {

    const transaction = db.transaction(() => {

      for (const table of BUSINESS_DATA_TABLES) {
        db.prepare(`DELETE FROM ${table}`).run();
      }

      clearSyncStateFor(db, SYNC_TABLE_NAMES_TO_CLEAR);

    });

    transaction();

    return { success: true };

  }
  catch (error) {

    console.error("ERP RESET FAILED", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during ERP reset."
    };

  }

}

export function performFactoryReset(): ResetResult {

  const db = getDatabase();

  try {

    const transaction = db.transaction(() => {

      for (const table of BUSINESS_DATA_TABLES) {
        db.prepare(`DELETE FROM ${table}`).run();
      }

      clearSyncStateFor(db, SYNC_TABLE_NAMES_TO_CLEAR);

      db.prepare(`DELETE FROM user_permissions`).run();
      db.prepare(`DELETE FROM profile_permissions`).run();
      db.prepare(`DELETE FROM permission_profiles`).run();
      db.prepare(`DELETE FROM sessions`).run();
      db.prepare(`DELETE FROM users`).run();

      // Reset company_settings back to first-run defaults rather than
      // deleting the singleton row -- company-settings-service.ts and
      // the auth bootstrap both assume id = 1 always exists.
      db.prepare(`
        UPDATE company_settings
        SET business_mode = 'starter',
            security_max_login_attempts = 5,
            security_lockout_minutes = 15,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run();

    });

    transaction();

    return { success: true };

  }
  catch (error) {

    console.error("FACTORY RESET FAILED", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during factory reset."
    };

  }

}
