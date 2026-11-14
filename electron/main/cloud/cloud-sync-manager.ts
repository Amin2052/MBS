import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDatabase } from "../../../src/database/database";
import { getCloudConfig, getDeviceId } from "./cloud-config-service";
import {
  createCloudRecord, updateCloudRecord, deleteCloudRecord, listCloudRecords,
  upsertCloudUser, syncCloudPermissions, CloudSyncConflictError, CloudSyncRevisionConflictError
} from "./cloud-client";
import {
  getMappingByCloudId, getMappingByLocalRow, upsertMapping, markMappingConflicted, deleteMappingByLocalRow,
  getSyncCursor, setSyncCursor, enqueueOfflineOperation, listOfflineQueue, removeOfflineQueueItem, recordOfflineQueueFailure
} from "../../../src/repositories/cloud-sync-repository";

const INTERVAL_MS = 15000;
// NOTE: permission_profiles, user_permissions, and profile_permissions are
// intentionally NOT in this list. They are fully covered by
// syncUsersAndPermissions() below, which POSTs them as one batch to the
// Worker's dedicated /v1/admin/permissions/sync endpoint. The Worker's
// handleData() explicitly refuses those 3 collections on the generic
// /v1/data/:collection path (400 "served by a dedicated endpoint") to avoid
// two code paths writing the same tables inconsistently -- so having them
// in this list too used to make every 15s sync cycle throw a guaranteed
// error for every row in those tables, on top of the correct sync that
// syncUsersAndPermissions() was already doing. This was also the root cause
// of the Owner-PC one-shot migration's "65 errors" (see
// scripts/owner-pc-d1-migrate.mjs, which had the identical CORE_TABLES bug).
// `permissions` (singular -- the static permission-definition catalog, not
// per-user grants) is unaffected and stays here; it IS allowed generically.
// NOTE: "permissions" (the static permission-definition catalog, e.g.
// "products.create") is deliberately NOT in this list. It is global
// reference data seeded identically on every fresh install (see
// seedDemoData()/schema init in src/database/database.ts) -- it has no
// workspace_id column (see 0002_workspace_isolation.sql's note on this
// exact point) and genuinely doesn't need per-tenant syncing at all, the
// same way a dictionary doesn't need syncing. It used to be in this list
// and pushed through the generic /v1/data/permissions path, which is what
// this comment is here to explain: once workspace scoping landed, every
// row failed with "table permissions has no column named workspace_id" --
// confirmed by tests/main/entry-bidirectional-sync.ts actually hitting
// this, not by inspection. Per-user/per-profile GRANTS (which ARE real
// tenant data) are handled separately and correctly by
// syncUsersAndPermissions() below, via the dedicated
// /v1/admin/permissions/sync endpoint.
const CORE_TABLES = [
  "products", "customers", "employees", "orders", "inventory_transactions", "transactions",
  "accounts", "journal_entries", "ledger_entries", "invoices", "certificates", "notifications",
  "employee_contracts",
  "company_settings"
] as const;

// PULLABLE_TABLES get REAL two-way sync (push AND pull, with stable
// cross-device identity via cloud_sync_map -- see
// src/repositories/cloud-sync-repository.ts and the schema comment in
// src/database/database.ts). The other CORE_TABLES stay push-only for now.
//
// Why these three are excluded, specifically:
//   - journal_entries (debit_account_id, credit_account_id)
//   - ledger_entries (account_id)
//   - employee_contracts (employee_id, previous_contract_id)
// all store RAW LOCAL INTEGER foreign keys to another synced table's `id`
// column (confirmed by reading src/database/database.ts's CREATE TABLE
// statements, not assumed). Every other CORE_TABLE either has no FK to
// another synced table, or already references one via a stable TEXT
// business key (orders.customer_id/product_id, inventory_transactions.
// product_id, invoices.customer_id/order_id all reference the business key,
// not the local integer id -- confirmed the same way). Pulling a
// journal_entries/ledger_entries/employee_contracts row onto a different
// device without translating its integer FK first would silently point it
// at whatever unrelated row happens to have that same integer id locally
// (or no row at all), which is a correctness bug worse than not syncing at
// all. Fixing this needs the same cloud_sync_map machinery used here, PLUS
// translating the FK integer to the referenced row's cloud_local_id on
// push and back to this device's own local id on pull, done in FK
// dependency order (accounts and employees must already exist locally
// before a journal_entries/employee_contracts row that references them is
// applied). That is real, scoped, follow-up work -- flagged here rather
// than half-implemented under time pressure against financial-ledger data.
const PULLABLE_TABLES = [
  "products", "customers", "employees", "accounts", "orders",
  "inventory_transactions", "transactions", "invoices", "certificates", "notifications"
] as const;
type PullableTable = typeof PULLABLE_TABLES[number];
function isPullable(table: string): table is PullableTable { return (PULLABLE_TABLES as readonly string[]).includes(table); }

let timer: NodeJS.Timeout | null = null;
let running = false;
let syncInFlight = false;

function statePath(): string { return path.join(app.getPath("userData"), "cloud-sync-state.json"); }

async function saveState(value: Record<string, unknown>): Promise<void> {
  await fs.writeFile(statePath(), JSON.stringify({ ...value, syncedAt: new Date().toISOString() }, null, 2), "utf8");
}

// Reads back the same state saveState() just wrote. Exists so the "Sync Now"
// IPC handler (see main.ts) can hand the real per-cycle result -- including
// userErrors/permissionsError, which syncOnce() now catches internally
// rather than throwing -- back to the Settings UI immediately, instead of
// only ever reaching a console log line a packaged Windows build has no way
// to show. Read-only; never touches the sync flow itself.
export async function getLastSyncState(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(statePath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function primaryKeyFor(table: string): string {
  if (table === "company_settings") return "id";
  if (["permission_profiles", "permissions", "user_permissions", "profile_permissions", "employees", "inventory_transactions", "transactions", "accounts", "journal_entries", "ledger_entries", "invoices", "certificates", "notifications", "employee_contracts"].includes(table)) return "id";
  if (table === "products") return "product_id";
  if (table === "customers") return "customer_id";
  if (table === "orders") return "id";
  return "id";
}

// The local table column with a natural, human-meaningful uniqueness that
// can double as a merge key on first pull -- e.g. matching an incoming
// cloud product to a local row that already happens to have the same
// product_id, before this device has ever seen a cloud_sync_map entry for
// it (a fresh install, or a row that existed locally before this session's
// pull machinery did). Returns null for tables with no such column, where
// cloud_sync_map is the only way to recognize "this is the same record".
function businessKeyColumnFor(table: string): string | null {
  if (table === "products") return "product_id";
  if (table === "customers") return "customer_id";
  if (table === "employees") return "employee_number";
  if (table === "accounts") return "code";
  if (table === "transactions") return "transaction_id";
  if (table === "invoices") return "invoice_id";
  if (table === "certificates") return "certificate_id";
  // orders/inventory_transactions/notifications have no single natural
  // business-unique column (orders.order_id is a display label, not
  // DB-unique; see 0001_mbs_core_schema.sql) -- cloud_sync_map is the only
  // merge key for these, same as before.
  return null;
}

function serializableRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    // Employee photos are local binary assets and are intentionally not sent through D1 JSON sync.
    if (key === "photo_blob" || key === "photo_mime") continue;
    if (Buffer.isBuffer(value)) continue;
    out[key] = value;
  }
  return out;
}

// Deterministic content hash used for dirty-tracking (see the comment on
// upsertMapping() in cloud-sync-repository.ts for why this exists at
// all). Object.entries() order for a plain object built field-by-field
// from a `SELECT *` row is stable for a given table schema within one
// process, but sorting keys explicitly here makes the hash independent
// of column order entirely -- cheap, and removes any doubt about it.
function computeContentHash(record: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// Node's fetch (undici) throws a TypeError (message "fetch failed", with a
// `.cause` like ECONNREFUSED/ENOTFOUND/ETIMEDOUT) for a genuine network
// failure -- as opposed to an Error thrown by cloud-client.ts wrapping a
// real HTTP response with a status code (4xx/5xx), which means the cloud
// WAS reached and rejected the request for an application reason (bad
// data, auth, conflict). Only the former should go to the offline queue
// for later retry; the latter would just fail identically on every retry
// and should be reported as a real error instead.
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(message);
}

let tableColumnsCache = new Map<string, Set<string>>();
function localColumnsFor(table: string): Set<string> {
  const cached = tableColumnsCache.get(table);
  if (cached) return cached;
  const db = getDatabase();
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const columns = new Set(info.map(c => c.name));
  tableColumnsCache.set(table, columns);
  return columns;
}
// Exposed for tests only, so a fresh in-memory schema mid-test isn't
// shadowed by a stale cache from an earlier test's database.
export function _resetLocalColumnsCacheForTests(): void { tableColumnsCache = new Map(); }

interface UsersAndPermissionsResult {
  users: number;
  userErrors: Array<{ username: string; message: string }>;
  permissionsSynced: boolean;
  permissionsError?: string;
}

async function syncUsersAndPermissions(): Promise<UsersAndPermissionsResult> {
  const config = getCloudConfig();
  const empty: UsersAndPermissionsResult = { users: 0, userErrors: [], permissionsSynced: false };
  if (!config.enabled || !config.apiUrl || !config.workspaceId || !config.apiKey) return empty;
  const db = getDatabase();
  const rows = db.prepare(`SELECT u.id,u.username,u.password_hash,u.user_type,u.status,u.employee_id,u.permission_profile_id,u.must_change_password,
    COALESCE(TRIM(e.first_name || ' ' || e.last_name), u.username) AS full_name
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id`).all() as Record<string, unknown>[];
  let count = 0;
  const userErrors: Array<{ username: string; message: string }> = [];
  for (const row of rows) {
    // Each user is isolated, the same way syncTable() isolates each business
    // record -- one user failing validation on the Worker must never stop
    // the other users in this batch, and (critically) must never stop the
    // syncCloudPermissions() call below, which is unrelated to any single
    // user's row. The old code let a single thrown error here escape the
    // whole function, which silently skipped permission_profiles/
    // profile_permissions/user_permissions sync every single 15s cycle
    // whenever any one user's data was rejected by the Worker.
    try {
      await upsertCloudUser({
        username: String(row.username), full_name: String(row.full_name || row.username), user_type: String(row.user_type),
        status: String(row.status), password_hash: String(row.password_hash), employee_id: row.employee_id == null ? null : Number(row.employee_id),
        permission_profile_id: row.permission_profile_id == null ? null : Number(row.permission_profile_id),
        must_change_password: Number(row.must_change_password || 0)
      });
      count++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      userErrors.push({ username: String(row.username), message });
      console.warn(`MBS Cloud sync error [users] ${String(row.username)}:`, message);
    }
  }
  const profiles = db.prepare("SELECT id,name,description,is_system FROM permission_profiles").all() as Array<{id:number;name:string;description:string;is_system:number}>;
  const profilePermissions = db.prepare("SELECT profile_id,permission_key,allowed FROM profile_permissions").all() as Array<{profile_id:number;permission_key:string;allowed:number}>;
  const userPermissions = db.prepare("SELECT user_id,permission_key,allowed FROM user_permissions").all() as Array<{user_id:number;permission_key:string;allowed:number}>;
  try {
    await syncCloudPermissions({ profiles, profilePermissions, userPermissions });
    return { users: count, userErrors, permissionsSynced: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("MBS Cloud sync error [permissions]:", message);
    return { users: count, userErrors, permissionsSynced: false, permissionsError: message };
  }
}

interface SyncTableResult {
  synced: number;
  conflicts: Array<{ table: string; type: "business_key" | "revision"; column?: string; value?: unknown; localId: string; message: string }>;
  errors: number;
  queued: number;
  deletedPushed: number;
}

// PUSH: local -> cloud. For PULLABLE_TABLES this now uses cloud_sync_map to
// tell creates from updates (so updates carry expected_revision and get
// real conflict detection instead of blindly upserting) and detects local
// deletes (a mapping whose local row no longer exists) to push as a real
// DELETE instead of just silently no-op'ing. Non-pullable tables keep the
// original unconditional-upsert behavior -- correct for a push-only table,
// since there's no pull-side revision to conflict with yet.
async function syncTable(table: string): Promise<SyncTableResult> {
  const db = getDatabase();
  const key = primaryKeyFor(table);
  const deviceId = getDeviceId();
  const result: SyncTableResult = { synced: 0, conflicts: [], errors: 0, queued: 0, deletedPushed: 0 };
  const pullable = isPullable(table);

  // Local deletes: a cloud_sync_map row for this table whose local_row_id
  // no longer has a matching local record means this device deleted it
  // since the last sync. Push a real DELETE for each before pushing
  // creates/updates for whatever rows remain.
  //
  // PERFORMANCE (Phase 9 audit): this used to be "fetch every mapping for
  // this table, then run one SELECT 1 FROM ${table} WHERE id=? PER
  // mapping" -- a classic N+1: 1 query to list mappings, then N more to
  // check each one individually, each also paying a fresh SQL-parse cost
  // (better-sqlite3 doesn't cache prepared statements across separate
  // .prepare() calls on its own). At MBS's realistic per-table row counts
  // (tens to low hundreds of synced records for a typical SMB, not
  // millions) this was never going to be a user-visible stall -- sync
  // runs on a 15s background interval, not blocking any UI interaction --
  // but it's still a real, easy, safe-to-fix inefficiency: a single
  // LEFT JOIN (the standard "rows in A with no match in B" SQL idiom)
  // returns exactly the same set of "mapping exists, local row doesn't"
  // rows in ONE query instead of 1+N, with identical results -- this is
  // purely a query-shape change, the actual delete-push logic below is
  // untouched.
  if (pullable) {
    const missingRows = db.prepare(`
      SELECT csm.local_row_id AS local_row_id, csm.cloud_local_id AS cloud_local_id
      FROM cloud_sync_map csm
      LEFT JOIN ${table} t ON t.id = csm.local_row_id
      WHERE csm.table_name = ? AND t.id IS NULL
    `).all(table) as Array<{ local_row_id: number; cloud_local_id: string }>;
    for (const mapped of missingRows) {
      try {
        await deleteCloudRecord(table, mapped.cloud_local_id);
        deleteMappingByLocalRow(table, mapped.local_row_id);
        result.deletedPushed++;
      } catch (error) {
        if (isNetworkError(error)) {
          enqueueOfflineOperation({ id: `delete:${table}:${mapped.cloud_local_id}`, collection: table, operation: "delete", payload: { cloudLocalId: mapped.cloud_local_id, localRowId: mapped.local_row_id } });
          result.queued++;
        } else {
          // 404 (already deleted on the cloud side too, e.g. by another
          // device) is not an error -- the end state we wanted is already
          // true. Anything else is a real error worth surfacing.
          const message = error instanceof Error ? error.message : String(error);
          if (/404|not found/i.test(message)) { deleteMappingByLocalRow(table, mapped.local_row_id); }
          else { result.errors++; console.warn(`MBS Cloud sync delete-push error [${table}]:`, message); }
        }
      }
    }
  }

  const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  for (const row of rows) {
    const record = serializableRow(row);
    const id = record[key];
    if (id === undefined || id === null || String(id) === "") continue;
    // Composite, device-prefixed identity: raw local autoincrement ids (or
    // business keys like product_id/customer_id generated by this device's
    // own local id_counters) are only guaranteed unique WITHIN this one
    // installation. Prefixing with this device's persistent id keeps two
    // different PCs' records from colliding in D1 before either has synced.
    // See getDeviceId() in cloud-config-service.ts.
    const compositeId = `${deviceId}:${table}:${id}`;
    const localRowId = Number(row.id);
    const mapping = pullable ? getMappingByLocalRow(table, localRowId) : undefined;
    const contentHash = computeContentHash(record);
    // DIRTY TRACKING: if this row is already mapped AND its content is
    // byte-for-byte identical to what was last successfully synced
    // (whether that sync was US pushing it, or a PULL applying someone
    // else's version), there is genuinely nothing to push. Skipping this
    // is not just an efficiency win (brief section 21: "do NOT
    // synchronize the entire database every interval" -- previously this
    // loop pushed every mapped row, every cycle, unconditionally) -- it
    // is a correctness fix. Without it, a record this device only ever
    // PULLED (never edited) still gets PATCHed right back up on the very
    // next cycle; the Worker's PATCH handler bumps sync_revision on any
    // successful update regardless of whether the submitted data actually
    // differs, so that redundant, content-identical PATCH silently
    // advances the shared revision -- making every OTHER device's
    // still-accurate mapping look stale and triggering spurious
    // "revision conflict"s for records nobody actually edited. Confirmed
    // as a real bug this way by tests/main/entry-bidirectional-sync.ts,
    // not hypothesized.
    if (mapping && mapping.content_hash === contentHash) continue;
    try {
      if (mapping) {
        // Known to the cloud already (either we pushed it before, or we
        // pulled it from elsewhere and are now pushing our own edit to
        // it) -- PATCH with expected_revision so a genuine conflict (cloud
        // moved since we last saw it) comes back as a clean 409 instead of
        // silently overwriting someone else's newer edit.
        const response = await updateCloudRecord(table, mapping.cloud_local_id, record, mapping.revision);
        upsertMapping(table, mapping.cloud_local_id, localRowId, Number(response.sync_revision ?? mapping.revision + 1), contentHash);
      } else {
        const response = await createCloudRecord(table, { ...record, id: compositeId });
        upsertMapping(table, compositeId, localRowId, Number(response.sync_revision ?? 1), contentHash);
      }
      result.synced++;
    } catch (error) {
      // One bad record must never block the rest of this table (or every
      // other table in this sync cycle) -- see syncOnce, which used to let
      // a single thrown error here abort the entire remaining cycle.
      if (error instanceof CloudSyncConflictError) {
        result.conflicts.push({ table, type: "business_key", column: error.column, value: error.value, localId: error.localId, message: error.message });
        console.warn(`MBS Cloud sync conflict [${table}]:`, error.message);
      } else if (error instanceof CloudSyncRevisionConflictError) {
        // Genuine conflict (brief section 7): both sides changed this
        // record and neither had seen the other's latest write. Per
        // sync-conflict-service.ts's acceptIfCurrent(), this is NOT
        // resolved automatically here -- no silent overwrite in either
        // direction. The local row is left exactly as the user has it
        // (their edit was never applied, this push just failed), and the
        // mapping's revision/content_hash stay unchanged so the next push
        // attempt re-triggers this same conflict rather than pretending
        // it resolved itself. Marking has_conflict=true is what makes
        // "no silent overwrite" actually hold end-to-end: without it, the
        // PULL step for this exact table -- which runs right after this,
        // in the SAME syncOnce() cycle -- would see the cloud's (someone
        // else's winning) revision as simply "newer than what I have" and
        // apply it over this device's own un-reconciled edit, silently
        // discarding it. Confirmed as a real bug this way by
        // tests/main/entry-bidirectional-sync.ts, not hypothesized.
        // applyPulledRow() checks this flag and skips applying updates to
        // a conflicted mapping until it's cleared (which happens
        // automatically the next time this record syncs successfully in
        // either direction -- see upsertMapping()).
        markMappingConflicted(table, mapping!.cloud_local_id);
        result.conflicts.push({ table, type: "revision", localId: mapping!.cloud_local_id, message: error.message });
        console.warn(`MBS Cloud sync revision conflict [${table}] ${mapping!.cloud_local_id}: local mapping thought revision=${mapping!.revision}, server says expected=${error.expectedRevision} actual=${error.currentRevision}`);
      } else if (isNetworkError(error)) {
        enqueueOfflineOperation({
          id: `${mapping ? "update" : "create"}:${compositeId}`,
          collection: table,
          operation: mapping ? "update" : "create",
          payload: mapping ? { cloudLocalId: mapping.cloud_local_id, record, expectedRevision: mapping.revision, localRowId } : { compositeId, record, localRowId }
        });
        result.queued++;
      } else {
        result.errors++;
        console.warn(`MBS Cloud sync error [${table}] record ${compositeId}:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return result;
}

// PULL: cloud -> local. Only for PULLABLE_TABLES (see the comment on that
// list above for exactly why the other three are excluded, and what
// finishing that follow-up would take). Incremental via the Worker's
// ?since=<updated_at cursor> (see 0004_sync_cursor_columns.sql):
// only asks for what changed since the last successful pull for this
// table, not the whole table every cycle.
interface PullTableResult { pulled: number; deletedLocally: number; skippedOwnEcho: number; errors: number; }

// Returns true if this pull actually changed local state (insert/update),
// false if it was correctly recognized as already-current and skipped
// (see the staleness guard below, and the comment on pullTable() for why
// that's the ONLY skip mechanism now).
function applyPulledRow(table: PullableTable, cloudRow: Record<string, unknown>): boolean {
  const db = getDatabase();
  const cloudLocalId = String(cloudRow.local_id ?? "");
  if (!cloudLocalId) return false;
  const cloudRevision = Number(cloudRow.sync_revision ?? 1);
  const isDeleted = Boolean(cloudRow.deleted_at);
  const businessKeyColumn = businessKeyColumnFor(table);
  const existingMapping = getMappingByCloudId(table, cloudLocalId);
  const localColumns = localColumnsFor(table);
  // Every real business column the Worker sent, intersected with what this
  // device's local table actually has -- keeps this forward-compatible if
  // either side gains/loses a column, and never tries to write the
  // sync-bookkeeping fields (local_id/workspace_id/updated_at/sync_revision/
  // deleted_at) into columns that don't hold them locally.
  const writable = Object.keys(cloudRow).filter(c => localColumns.has(c) && c !== "id" && c !== "local_id" && c !== "workspace_id" && c !== "updated_at" && c !== "sync_revision" && c !== "deleted_at");

  let localRowId: number | null = existingMapping ? existingMapping.local_row_id : null;

  // No mapping yet: try to find an existing LOCAL row by business key
  // first. Covers a record that already exists locally (created
  // independently on this device before either side had synced, or
  // migrated in before cloud_sync_map existed) with the same business
  // identity -- treat it as the same record rather than creating a
  // duplicate.
  if (localRowId === null && businessKeyColumn && cloudRow[businessKeyColumn]) {
    const found = db.prepare(`SELECT id FROM ${table} WHERE ${businessKeyColumn}=?`).get(cloudRow[businessKeyColumn]) as { id: number } | undefined;
    if (found) localRowId = found.id;
  }

  if (isDeleted) {
    if (localRowId !== null) {
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(localRowId);
      deleteMappingByLocalRow(table, localRowId);
    }
    return true;
  }

  if (localRowId !== null) {
    // Conflict guard: if this device has an un-reconciled local edit
    // that just lost a push conflict for this exact record (see
    // markMappingConflicted() at the CloudSyncRevisionConflictError catch
    // above), do NOT let this pull silently overwrite it with the
    // winning side's version -- that would defeat the entire point of
    // rejecting the push in the first place. The user's edit stays on
    // disk, visibly diverged from cloud, until it naturally resyncs
    // (upsertMapping() clears this flag on any future successful sync of
    // this record, from either direction).
    if (existingMapping?.has_conflict) return false;
    // Stale/out-of-order delivery guard: this is now the ONLY
    // "is this actually new to us" check (an earlier, separate
    // device-prefix-based "skip our own echo" check was removed here --
    // see the comment on pullTable() below for exactly why it was wrong,
    // not just redundant). Covers three real cases uniformly: (a) a
    // record we ourselves just pushed being echoed back in the same
    // cycle (mapping.revision was already set to match at push time, so
    // cloudRevision <= existingMapping.revision here), (b) a retried or
    // page-boundary-duplicated delivery of something we already applied,
    // and (c) genuinely nothing to do. Never skips a real edit from
    // another device, because that always arrives with a STRICTLY HIGHER
    // revision than whatever this device last recorded.
    if (existingMapping && cloudRevision <= existingMapping.revision) return false;
    if (writable.length) {
      const setClause = writable.map(c => `${c}=?`).join(",");
      const values = writable.map(c => cloudRow[c] ?? null);
      db.prepare(`UPDATE ${table} SET ${setClause} WHERE id=?`).run(...values, localRowId);
    }
  } else {
    if (!writable.length) return false;
    const placeholders = writable.map(() => "?").join(",");
    const values = writable.map(c => cloudRow[c] ?? null);
    const info = db.prepare(`INSERT INTO ${table}(${writable.join(",")}) VALUES(${placeholders})`).run(...values);
    localRowId = Number(info.lastInsertRowid);
  }
  // Re-read the row exactly as a subsequent push would SELECT it (not the
  // `cloudRow`/`writable` shape used above -- those have a different
  // column set: cloud-only bookkeeping columns like local_id/workspace_id/
  // sync_revision/deleted_at aren't local columns at all, and hashing
  // them directly would never match what serializableRow()+
  // computeContentHash() produces for a genuine local SELECT * row).
  // Recording a hash that's computed the same way on both sides is what
  // makes the dirty-tracking check in syncTable() actually work: a row
  // that was just pulled and not edited must hash identically here and
  // on the next push attempt, so that push is correctly skipped as clean.
  const freshLocalRow = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(localRowId) as Record<string, unknown>;
  const appliedContentHash = computeContentHash(serializableRow(freshLocalRow));
  upsertMapping(table, cloudLocalId, localRowId, cloudRevision, appliedContentHash);
  return true;
}

async function pullTable(table: PullableTable): Promise<PullTableResult> {
  const result: PullTableResult = { pulled: 0, deletedLocally: 0, skippedOwnEcho: 0, errors: 0 };
  let cursor = getSyncCursor(table);
  const startingCursor = cursor;
  for (;;) {
    const { rows } = await listCloudRecords(table, 500, cursor);
    if (!rows.length) break;
    for (const cloudRow of rows) {
      try {
        if (cloudRow.deleted_at) { result.deletedLocally += applyPulledRowCountingDeletes(table, cloudRow); }
        else {
          // NOTE: there is deliberately NO "skip if this record's
          // cloud_local_id was originally created by THIS device"
          // shortcut here anymore. cloud_local_id is assigned once, at
          // CREATE time, and never changes -- it reflects who ORIGINATED
          // the record, not who most recently edited it. A device-prefix
          // check here would (and, before this fix, actually did --
          // confirmed by tests/main/entry-bidirectional-sync.ts, not
          // hypothesized) wrongly skip a genuine edit made by a DIFFERENT
          // device to a record this device happened to create first --
          // exactly the "PC B edits a record PC A created" scenario the
          // whole point of pulling exists to support. applyPulledRow()'s
          // own revision-staleness guard is the correct and sufficient
          // way to recognize "I already have this exact version" --
          // including the case where "this" really is our own echo,
          // since our own push already advanced our mapping's revision
          // to match before this pull runs.
          if (applyPulledRow(table, cloudRow)) result.pulled++;
          else result.skippedOwnEcho++;
        }
      } catch (error) {
        result.errors++;
        console.warn(`MBS Cloud pull error [${table}]:`, error instanceof Error ? error.message : error);
      }
    }
    const lastUpdatedAt = String(rows[rows.length - 1]?.updated_at || "");
    if (!lastUpdatedAt || lastUpdatedAt === cursor) break; // no progress possible, avoid an infinite loop
    cursor = lastUpdatedAt;
    if (rows.length < 500) break; // reached the last page
  }
  if (cursor !== startingCursor) setSyncCursor(table, cursor);
  return result;
}

function applyPulledRowCountingDeletes(table: PullableTable, cloudRow: Record<string, unknown>): number {
  const before = getMappingByCloudId(table, String(cloudRow.local_id ?? ""));
  applyPulledRow(table, cloudRow);
  return before ? 1 : 0;
}

// Retries whatever is sitting in the persisted offline queue (see
// src/repositories/cloud-sync-repository.ts) before this cycle's normal
// push/pull pass. Runs first so a long stretch offline doesn't get
// permanently behind: whatever queued up gets first priority once
// connectivity is back, ahead of re-deriving the same state from a fresh
// table scan.
async function drainOfflineQueue(): Promise<{ drained: number; stillQueued: number }> {
  const items = listOfflineQueue();
  let drained = 0;
  for (const item of items) {
    try {
      const payload = JSON.parse(item.payload) as Record<string, unknown>;
      if (item.operation === "create") {
        const response = await createCloudRecord(item.collection, { ...(payload.record as Record<string, unknown>), id: payload.compositeId });
        upsertMapping(item.collection, String(payload.compositeId), Number(payload.localRowId), Number(response.sync_revision ?? 1), computeContentHash(payload.record as Record<string, unknown>));
      } else if (item.operation === "update") {
        const response = await updateCloudRecord(item.collection, String(payload.cloudLocalId), payload.record as Record<string, unknown>, Number(payload.expectedRevision));
        upsertMapping(item.collection, String(payload.cloudLocalId), Number(payload.localRowId), Number(response.sync_revision ?? Number(payload.expectedRevision) + 1), computeContentHash(payload.record as Record<string, unknown>));
      } else if (item.operation === "delete") {
        try { await deleteCloudRecord(item.collection, String(payload.cloudLocalId)); }
        catch (error) { if (!/404|not found/i.test(error instanceof Error ? error.message : String(error))) throw error; }
        deleteMappingByLocalRow(item.collection, Number(payload.localRowId));
      }
      removeOfflineQueueItem(item.id);
      drained++;
    } catch (error) {
      if (isNetworkError(error)) {
        // Still offline -- stop draining for this cycle rather than
        // burning through the whole queue against an unreachable host;
        // the next cycle will pick up where this left off. Order is
        // preserved (listOfflineQueue() returns oldest-first) so this is
        // a clean "still stuck here", not lost progress.
        break;
      }
      if (error instanceof CloudSyncRevisionConflictError) {
        // Same handling as the main push path in syncTable(): a genuine
        // conflict, not a transient failure -- retrying this exact queued
        // update against the same stale expected_revision would just
        // fail identically forever, so it's removed from the queue (not
        // silently dropped: the mapping is marked has_conflict so the
        // pull path won't overwrite this device's local edit either, and
        // it's surfaced in result.conflicts the same way).
        const payload = JSON.parse(item.payload) as Record<string, unknown>;
        markMappingConflicted(item.collection, String(payload.cloudLocalId));
        removeOfflineQueueItem(item.id);
        console.warn(`MBS offline queue item hit a genuine conflict on replay [${item.collection}/${item.operation}]:`, error.message);
        continue;
      }
      // A real application-level rejection (e.g. the record was deleted
      // out from under this queued update) -- record it and move on to
      // the rest of the queue rather than getting stuck retrying
      // something that will never succeed as-is.
      recordOfflineQueueFailure(item.id, error instanceof Error ? error.message : String(error));
      console.warn(`MBS offline queue item failed permanently [${item.collection}/${item.operation}]:`, error);
    }
  }
  return { drained, stillQueued: listOfflineQueue().length };
}

async function syncOnce(): Promise<void> {
  const config = getCloudConfig();
  if (!config.enabled || !config.apiUrl || !config.workspaceId || !config.apiKey || syncInFlight) return;
  syncInFlight = true;
  try {
    const queueResult = await drainOfflineQueue();
    const userResult = await syncUsersAndPermissions();
    let records = 0;
    let pulled = 0;
    let deletedLocally = 0;
    let deletedPushed = 0;
    let errors = 0;
    let queued = queueResult.stillQueued;
    const conflicts: SyncTableResult["conflicts"] = [];
    for (const table of CORE_TABLES) {
      const pushResult = await syncTable(table);
      records += pushResult.synced;
      errors += pushResult.errors;
      queued += pushResult.queued;
      deletedPushed += pushResult.deletedPushed;
      conflicts.push(...pushResult.conflicts);
      if (isPullable(table)) {
        const pullResult = await pullTable(table);
        pulled += pullResult.pulled;
        deletedLocally += pullResult.deletedLocally;
        errors += pullResult.errors;
      }
    }
    await saveState({
      users: userResult.users, userErrors: userResult.userErrors,
      permissionsSynced: userResult.permissionsSynced, permissionsError: userResult.permissionsError ?? null,
      records, pulled, deletedPushed, deletedLocally, errors, queued, offlineDrained: queueResult.drained, conflicts
    });
    const conflictNote = conflicts.length ? `, ${conflicts.length} conflict(s) need manual resolution` : "";
    const errorNote = errors ? `, ${errors} record error(s)` : "";
    const queueNote = queued ? `, ${queued} operation(s) queued offline` : "";
    const userErrorNote = userResult.userErrors.length ? `, ${userResult.userErrors.length} user sync error(s)` : "";
    const permNote = userResult.permissionsSynced ? "" : `, permission sync failed: ${userResult.permissionsError}`;
    console.log(`MBS Cloud: synced ${userResult.users} users, pushed ${records}, pulled ${pulled}${conflictNote}${errorNote}${queueNote}${userErrorNote}${permNote}.`);
  } catch (error) {
    console.warn("MBS Cloud sync skipped:", error instanceof Error ? error.message : error);
  } finally {
    syncInFlight = false;
  }
}

export async function startCloudSync(): Promise<void> {
  if (running) return;
  running = true;
  await syncOnce();
  timer = setInterval(() => { void syncOnce(); }, INTERVAL_MS);
}

export function stopCloudSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

export async function syncCloudNow(): Promise<void> { await syncOnce(); }
