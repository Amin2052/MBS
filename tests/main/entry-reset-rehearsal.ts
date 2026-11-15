// Staging rehearsal of the destructive pair an owner would actually perform:
// central business reset, then recovery from the pre-reset backup.
//
// "Staging" here is the real Worker code over the real schema (all six
// migrations) with D1's API emulated by the shim, plus a real MBS SQLite
// database and the real backup/restore service. It is the strongest rehearsal
// available without production D1 credentials -- and it is deliberately done
// on a temp database, never on a real one.
//
// Sequence:
//   1. snapshot local business counts
//   2. write the pre-reset backup the app writes
//   3. seed central rows, then perform the central reset as the owner
//   4. clear the local copy exactly as the app does after a central reset
//   5. restore from the backup and compare counts
//   6. prove the epoch guard still lets a re-baselined client repopulate, and
//      still refuses a stale one
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { app } from "electron";

import { createD1Shim } from "./helpers/d1-shim";
import { startRealWorkerServer } from "./helpers/real-worker-http-server";

async function main() {
  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) { failures++; console.error("FAIL:", label); }
    else { console.log("PASS:", label); }
  }
  function assertEqual(actual: unknown, expected: unknown, label: string) {
    assertTrue(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-reset-rehearsal-"));
  const userData = path.join(root, "userdata");
  // app.setPath does not create the directory; the SQLite open does not
  // create it either, so create it before the first getDatabase().
  fs.mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);

  const shim = createD1Shim(path.join(root, "staging-d1.sqlite"));
  const repoRoot = process.cwd();
  for (const migration of [
    "0001_mbs_core_schema", "0002_workspace_isolation", "0003_workspace_unique_constraints",
    "0004_sync_cursor_columns", "0005_sync_tombstones", "0006_workspace_reset_epoch"
  ]) {
    shim.raw.exec(fs.readFileSync(path.join(repoRoot, `cloudflare/migrations/${migration}.sql`), "utf8"));
  }

  const ADMIN_KEY = "test-only-admin-key";
  const worker = await startRealWorkerServer({ DB: shim.DB, MBS_ADMIN_KEY: ADMIN_KEY });

  async function call(method: string, urlPath: string, options: { headers?: Record<string, string>; body?: unknown } = {}) {
    const response = await fetch(`${worker.url}${urlPath}`, {
      method,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    return { status: response.status, json };
  }

  const { getDatabase } = await import("../../src/database/database");
  const { countLocalBusinessRows, clearLocalBusinessData, clearAllSyncBookkeeping } = await import("../../electron/main/reset-service");
  const { createBackup, restoreFromBackup, checkDatabaseIntegrity } = await import("../../electron/main/backup-service");

  getDatabase();
  const before = countLocalBusinessRows();
  const beforeTotal = Object.values(before).reduce((sum, n) => sum + n, 0);
  assertTrue(beforeTotal > 0, `Local database has business data to protect (${beforeTotal} rows)`);

  // ---- 1. the safety backup the reset path insists on ----
  const backupPath = path.join(root, "pre-central-reset.mbsbackup");
  const backup = await createBackup(backupPath);
  assertTrue(backup.success, "Pre-reset backup was written");
  assertTrue(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0, "Backup file exists and is not empty");

  // ---- 2. central data, then the central reset ----
  const provision = await call("POST", "/v1/admin/workspaces", {
    headers: { "x-admin-key": ADMIN_KEY },
    body: { workspaceId: "staging-co", name: "Staging Co" }
  });
  assertEqual(provision.status, 201, "Staging workspace provisioned");
  const workspaceId = provision.json.workspaceId as string;
  const apiKey = provision.json.apiKey as string;
  const auth = (extra: Record<string, string> = {}) => ({ "x-workspace-id": workspaceId, "x-api-key": apiKey, ...extra });

  for (const table of ["products", "customers", "orders"]) {
    const created = await call("POST", `/v1/data/${table}`, {
      headers: auth(),
      body: {
        id: `dev1:${table}:1`,
        ...(table === "products" ? { product_id: "PRD-R1", name: "Rehearsal widget", price: 10, stock: 3 } : {}),
        ...(table === "customers" ? { customer_id: "CUS-R1", name: "Rehearsal customer", phone: "123" } : {}),
        ...(table === "orders" ? { order_id: "ORD-R1", customer_name: "Rehearsal customer", total: 30, status: "Pending" } : {})
      }
    });
    assertTrue(created.status === 200 || created.status === 201, `Central ${table} seeded for the rehearsal`);
  }

  const reset = await call("POST", "/v1/admin/reset", {
    headers: auth(),
    body: { scope: "business", confirm: workspaceId }
  });
  assertEqual(reset.status, 200, "Central reset performed");
  assertEqual(reset.json.resetEpoch, 1, "Central reset produced epoch 1");
  for (const table of ["products", "customers", "orders"]) {
    const listing = await call("GET", `/v1/data/${table}`, { headers: auth() });
    assertEqual(listing.json?.rows?.length, 0, `Central ${table} is empty after the reset`);
  }

  // ---- 3. clear this device exactly as the app does ----
  const cleared = clearLocalBusinessData();
  assertTrue(cleared.success, "Local copy cleared after the central reset");
  clearAllSyncBookkeeping();
  const afterReset = countLocalBusinessRows();
  assertEqual(Object.values(afterReset).reduce((sum, n) => sum + n, 0), 0, "This device is empty after the reset");

  // ---- 4. recovery from the backup ----
  const restore = await restoreFromBackup(backupPath);
  assertTrue(restore.success, "Restore from the pre-reset backup succeeded");
  assertTrue(Boolean(restore.safetyBackupPath), "Restore wrote its own safety backup of the empty database");
  assertTrue(fs.existsSync(restore.safetyBackupPath as string), "That safety backup exists on disk");

  const restored = countLocalBusinessRows();
  const restoredTotal = Object.values(restored).reduce((sum, n) => sum + n, 0);
  assertEqual(restoredTotal, beforeTotal, "Restored row count matches the pre-reset snapshot");
  for (const table of Object.keys(before)) {
    assertEqual(restored[table], before[table], `${table} count restored exactly`);
  }

  const integrity = checkDatabaseIntegrity();
  assertTrue(integrity.success && integrity.ok, "Restored database passes the integrity check");

  // ---- 5. a re-baselined client can repopulate; a stale one still cannot ----
  const stalePush = await call("POST", "/v1/data/products", {
    headers: auth({ "x-reset-epoch": "0" }),
    body: { id: "dev1:products:99", product_id: "PRD-STALE", name: "Stale", price: 1, stock: 1 }
  });
  assertEqual(stalePush.status, 409, "SECURITY: a stale-epoch client still cannot write after recovery");

  const rebuilt = await call("POST", "/v1/data/products", {
    headers: auth({ "x-reset-epoch": "1" }),
    body: { id: "dev1:products:100", product_id: "PRD-RESTORED", name: "Restored widget", price: 10, stock: 3 }
  });
  assertTrue(rebuilt.status === 200 || rebuilt.status === 201, "A re-baselined client can repopulate the central workspace");

  const repopulated = await call("GET", "/v1/data/products", { headers: auth() });
  assertEqual(repopulated.json?.rows?.length, 1, "The repopulated central product is readable");

  await worker.close();

  if (failures > 0) {
    console.error(`\n${failures} RESET REHEARSAL CHECK(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nRESET + RESTORE REHEARSAL PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("RESET REHEARSAL CRASHED", error);
  process.exit(1);
});
