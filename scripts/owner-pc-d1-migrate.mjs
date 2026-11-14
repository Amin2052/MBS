#!/usr/bin/env node
/**
 * Owner-PC SQLite -> D1 one-time migration tool.
 *
 * WHAT THIS DOES
 * Reads every CORE_TABLE row from the Owner PC's local MBS SQLite database
 * and pushes it to the already-deployed Worker's relational API, using the
 * SAME device-prefixed composite-id scheme the app's own background sync
 * uses (electron/main/cloud/cloud-sync-manager.ts: `${deviceId}:${table}:${id}`).
 * This is deliberately the existing sync path, not a new one — it just runs
 * it once, synchronously, with full result reporting, instead of waiting
 * for the normal 15-second interval to eventually cover everything.
 *
 * SAFETY
 * - Every write is an upsert (`INSERT ... ON CONFLICT(local_id) DO UPDATE`,
 *   implemented server-side in cloudflare/worker/index.js). Re-running this
 *   script after a partial failure is safe: already-migrated rows are
 *   updated in place, not duplicated.
 * - A genuine business-key collision (e.g. two devices' product_id values
 *   colliding) is reported by the Worker as `409 business_key_conflict` and
 *   is recorded, not silently overwritten or fatal to the run.
 * - A single row's failure does not stop the rest of its table, and one
 *   table's failure does not stop the other tables (matches the isolation
 *   behavior already implemented in cloud-sync-manager.ts).
 * - This script never touches `messages` or `erp_data` — they are not MBS
 *   collections and are out of scope for this tool.
 * - This script performs writes against whatever --api-url you point it at.
 *   Point it at a non-production Worker first if you want a dry run against
 *   real data shapes before running it against the production Worker URL.
 *
 * NOT COVERED (by design, not oversight)
 * - Users/passwords and permission profiles: already migrated by the
 *   existing dedicated flow (cloud-sync-manager.ts: syncUsersAndPermissions
 *   -> POST /v1/users, POST /v1/admin/permissions/sync), which the desktop
 *   app runs automatically every 15s whenever Cloud sync is enabled. This
 *   script's CORE_TABLES used to also list permission_profiles/
 *   user_permissions/profile_permissions and push them a SECOND time through
 *   the generic /v1/data/:collection path -- which the Worker refuses with
 *   400 for those 3 collections specifically because they already have a
 *   dedicated path. That was the actual root cause of the real run's "65
 *   errors" (see git history / FINAL_HANDOVER.md). Fixed by removing them
 *   from CORE_TABLES; re-run the app's normal cloud sync (or trigger it via
 *   syncCloudNow()) for that data instead of extending this script.
 * - `mbs_messages`: the Worker only exposes single-message create
 *   (POST /v1/messages), not a bulk-import endpoint. Bulk-migrating
 *   historical local messages would need a new Worker endpoint — that is
 *   new architecture and is intentionally NOT invented here. Flagging as
 *   pending, not silently skipped.
 *
 * USAGE
 *   node scripts/owner-pc-d1-migrate.mjs \
 *     --db "C:\Users\Owner\AppData\Roaming\MBS\mbs.db" \
 *     --api-url https://mooral-mbs-api.<account>.workers.dev \
 *     --workspace-id mooral-main \
 *     --api-key <MBS_API_KEY> \
 *     [--dry-run] \
 *     [--tables products,customers,...] \
 *     [--retry-from <previous-owner-pc-migration-result-*.json>]
 *
 * --tables restricts the run to specific CORE_TABLES entries (comma-
 * separated, no spaces). Use this for a targeted re-run instead of the full
 * table list -- e.g. after fixing the D1 "too many SQL variables" bug in
 * handleCompanySettings, `--tables company_settings` retries just that one
 * table without touching the other 357 already-synced records.
 *
 * --retry-from points at a previous run's structured result JSON (the
 * `owner-pc-migration-result-<timestamp>.json` file this script writes on
 * every run). When given, this run is restricted to ONLY the specific rows
 * that were recorded under `errors` in that file for each table (matched by
 * the row's own local primary-key value, recovered from the failed record's
 * stored composite id `${deviceId}:${table}:${localPk}`) -- rows that
 * previously synced successfully or hit a 409 business_key_conflict are
 * skipped entirely, so this can never re-send or duplicate the 358 rows
 * that already succeeded. Combine with --tables to also narrow by table.
 *
 * The Owner-PC SQLite file path is NOT known to this tool in advance and is
 * NOT bundled with it. You must supply the real --db path when you run this
 * on the Owner's machine. This script will refuse to run against a
 * nonexistent file rather than fabricate results.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// permission_profiles, user_permissions, profile_permissions are deliberately
// excluded -- see the "NOT COVERED" note in this file's header. They are
// already covered by the app's own dedicated sync path
// (cloud-sync-manager.ts: syncUsersAndPermissions -> POST
// /v1/admin/permissions/sync). Cloudflare/worker/index.js's handleData()
// explicitly refuses these 3 collections on the generic /v1/data/:collection
// path with 400 ("served by a dedicated endpoint"), so previously having
// them here made every one of their rows fail with a guaranteed 400 on any
// REAL run. --dry-run never calls the network at all, so it never surfaced
// this: that's exactly why the dry run predicted 423/0/0 but the real run
// came back 358/0/65 (423-358 = 65, matching the row count of these 3
// tables in the Owner PC's database). `permissions` (singular -- the static
// permission-definition catalog) is unaffected and stays; it IS allowed on
// the generic path.
const CORE_TABLES = [
  "products", "customers", "employees", "orders", "inventory_transactions", "transactions",
  "accounts", "journal_entries", "ledger_entries", "invoices", "certificates", "notifications",
  "employee_contracts", "permissions",
  "company_settings",
];

function primaryKeyFor(table) {
  if (table === "company_settings") return "id";
  if (table === "products") return "product_id";
  if (table === "customers") return "customer_id";
  return "id";
}

function serializableRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "photo_blob" || key === "photo_mime") continue;
    if (Buffer.isBuffer(value)) continue;
    out[key] = value;
  }
  return out;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--api-url") args.apiUrl = argv[++i];
    else if (a === "--workspace-id") args.workspaceId = argv[++i];
    else if (a === "--api-key") args.apiKey = argv[++i];
    else if (a === "--device-id") args.deviceId = argv[++i];
    else if (a === "--tables") args.tables = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--retry-from") args.retryFrom = argv[++i];
  }
  return args;
}

// Builds { table: Set(localPkAsString) } from a previous run's result JSON,
// covering only rows that were recorded as `errors` (never rows that
// already succeeded, and never 409 business_key_conflicts -- those need a
// person to resolve the colliding business key, not a blind retry).
function loadRetryFilter(retryFromPath) {
  if (!fs.existsSync(retryFromPath)) {
    console.error(`--retry-from file not found: ${retryFromPath}`);
    process.exit(1);
  }
  const prior = JSON.parse(fs.readFileSync(retryFromPath, "utf8"));
  const filter = {};
  for (const [table, result] of Object.entries(prior.tables || {})) {
    if (!result || !Array.isArray(result.errors) || !result.errors.length) continue;
    const ids = new Set();
    for (const err of result.errors) {
      // localId is `${deviceId}:${table}:${localPk}` -- localPk may itself
      // contain ':' for some business keys, so split on the table name's
      // own segment rather than a fixed index.
      const marker = `:${table}:`;
      const idx = String(err.localId || "").indexOf(marker);
      if (idx === -1) continue;
      ids.add(err.localId.slice(idx + marker.length));
    }
    if (ids.size) filter[table] = ids;
  }
  return filter;
}

function getOrCreateDeviceId(explicit) {
  if (explicit) return explicit;
  // Mirrors electron/main/cloud/cloud-config-service.ts getDeviceId() so
  // records created by this tool reconcile with the app's own future syncs
  // instead of minting a second, orphaned device identity.
  const idPath = path.join(process.cwd(), ".owner-pc-migrate-device-id.json");
  try {
    if (fs.existsSync(idPath)) {
      const raw = JSON.parse(fs.readFileSync(idPath, "utf8"));
      if (raw.deviceId) return raw.deviceId;
    }
  } catch { /* fall through */ }
  const generated = crypto.randomUUID();
  try {
    fs.writeFileSync(idPath, JSON.stringify({ deviceId: generated, createdAt: new Date().toISOString() }, null, 2));
  } catch { /* best-effort */ }
  console.warn(`WARNING: no --device-id supplied and no cached id found. Generated a NEW device id (${generated}).`);
  console.warn(`If this Owner PC already has a device id from normal app usage (cloud-sync-state.json / device-id.json in its userData folder), pass it explicitly with --device-id so records reconcile correctly instead of double-syncing under a second identity.`);
  return generated;
}

async function postRecord(args, table, localId, record) {
  const url = `${args.apiUrl.replace(/\/$/, "")}/v1/data/${table}/${encodeURIComponent(localId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": args.apiKey,
      "x-workspace-id": args.workspaceId,
    },
    body: JSON.stringify({ ...record, id: localId }),
  });
  const bodyText = await res.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText }; }
  return { status: res.status, body };
}

async function migrateTable(db, args, table, deviceId, results, retryFilter) {
  const key = primaryKeyFor(table);
  let rows;
  try {
    rows = db.prepare(`SELECT * FROM ${table}`).all();
  } catch (error) {
    // Table missing locally is not fatal to the rest of the run.
    results.tables[table] = { skipped: true, reason: `local table unreadable: ${error.message}` };
    return;
  }
  const retryIds = retryFilter ? retryFilter[table] : null;
  if (retryFilter && !retryIds) {
    // --retry-from was given but this table had no recorded errors last
    // time -- nothing to retry here, skip without touching it.
    results.tables[table] = { skipped: true, reason: "no prior errors recorded for this table in --retry-from", total: rows.length };
    return;
  }
  const tableResult = { synced: 0, conflicts: [], errors: [], total: rows.length };
  for (const row of rows) {
    const record = serializableRow(row);
    const id = record[key];
    if (id === undefined || id === null || String(id) === "") continue;
    if (retryIds && !retryIds.has(String(id))) continue;
    const compositeId = `${deviceId}:${table}:${id}`;
    if (args.dryRun) { tableResult.synced++; continue; }
    try {
      const { status, body } = await postRecord(args, table, compositeId, record);
      if (status === 409) {
        tableResult.conflicts.push({ localId: compositeId, ...body });
      } else if (status >= 200 && status < 300) {
        tableResult.synced++;
      } else {
        tableResult.errors.push({ localId: compositeId, status, body });
      }
    } catch (error) {
      // One record's network/parse failure must not stop the rest of this
      // table or any other table.
      tableResult.errors.push({ localId: compositeId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  results.tables[table] = tableResult;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db) { console.error("Missing required --db <path-to-owner-pc-sqlite-file>"); process.exit(1); }
  if (!fs.existsSync(args.db)) {
    console.error(`SQLite file not found at: ${args.db}`);
    console.error("This tool will not fabricate a migration result. Re-run with the real Owner-PC database path.");
    process.exit(1);
  }
  if (!args.dryRun) {
    for (const required of ["apiUrl", "workspaceId", "apiKey"]) {
      if (!args[required]) { console.error(`Missing required --${required.replace(/[A-Z]/g, m => "-" + m.toLowerCase())} (or pass --dry-run to skip network calls).`); process.exit(1); }
    }
  }

  const db = new Database(args.db, { readonly: true, fileMustExist: true });
  const deviceId = getOrCreateDeviceId(args.deviceId);
  const retryFilter = args.retryFrom ? loadRetryFilter(args.retryFrom) : null;
  const tablesToRun = args.tables && args.tables.length
    ? CORE_TABLES.filter(t => args.tables.includes(t))
    : CORE_TABLES;
  if (args.tables) {
    const unknown = args.tables.filter(t => !CORE_TABLES.includes(t));
    if (unknown.length) console.warn(`WARNING: --tables named unknown/unsupported table(s), ignored: ${unknown.join(", ")}`);
  }

  const results = { db: args.db, deviceId, dryRun: args.dryRun, retryFrom: args.retryFrom || null, startedAt: new Date().toISOString(), tables: {} };
  for (const table of tablesToRun) {
    await migrateTable(db, args, table, deviceId, results, retryFilter);
  }
  results.finishedAt = new Date().toISOString();
  db.close();

  const outPath = path.join(process.cwd(), `owner-pc-migration-result-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  let totalSynced = 0, totalConflicts = 0, totalErrors = 0;
  for (const t of Object.values(results.tables)) {
    if (t.skipped) continue;
    totalSynced += t.synced || 0;
    totalConflicts += (t.conflicts || []).length;
    totalErrors += (t.errors || []).length;
  }
  console.log(`\n${args.dryRun ? "[DRY RUN] " : ""}Owner-PC migration complete.`);
  console.log(`  Synced:    ${totalSynced}`);
  console.log(`  Conflicts: ${totalConflicts} (409 business_key_conflict -- needs manual review, listed in ${outPath})`);
  console.log(`  Errors:    ${totalErrors} (listed in ${outPath})`);
  console.log(`  Full structured result written to: ${outPath}`);
  console.log(`\nNOT covered by this run (see script header): users/permissions sync, mbs_messages history.`);
}

main().catch((error) => {
  console.error("Fatal migration error:", error);
  process.exit(1);
});
