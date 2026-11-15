// Central (cloud) reset + local reset helpers, against the ACTUAL
// cloudflare/worker/index.js running as a real HTTP server over a real
// SQLite database with the real migrations (including 0006), not a
// reimplementation of the endpoints.
//
// What this proves, and why each assertion exists:
//   - only the workspace API key can reset central data (an employee Bearer
//     session is refused) -> the owner's key is the actual trust boundary;
//   - the confirmation must equal the workspace id;
//   - business rows are gone, while employee logins, permission grants,
//     employee records and workspace settings survive;
//   - the reset bumps the epoch, is recorded in workspace_resets, and a
//     stale device can no longer write its pre-reset copy back (409) while
//     reads stay available so it can recover;
//   - the local helpers the main app uses really do empty the business
//     tables and the sync bookkeeping.
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-cloud-reset-"));
  app.setPath("userData", path.join(tmpDir, "userdata"));

  const shim = createD1Shim(path.join(tmpDir, "worker.sqlite"));
  const repoRoot = process.cwd();
  for (const migration of [
    "0001_mbs_core_schema", "0002_workspace_isolation", "0003_workspace_unique_constraints",
    "0004_sync_cursor_columns", "0005_sync_tombstones", "0006_workspace_reset_epoch"
  ]) {
    shim.raw.exec(fs.readFileSync(path.join(repoRoot, `cloudflare/migrations/${migration}.sql`), "utf8"));
  }

  const ADMIN_KEY = "test-only-admin-key";
  const env: any = { DB: shim.DB, MBS_CORS_ORIGIN: "http://localhost", MBS_ADMIN_KEY: ADMIN_KEY };
  const worker = await startRealWorkerServer(env);

  function scryptHashSync(password: string): string {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
  }

  async function call(method: string, urlPath: string, options: { headers?: Record<string, string>; body?: unknown } = {}) {
    const response = await fetch(`${worker.url}${urlPath}`, {
      method,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain-text error */ }
    return { status: response.status, json, text };
  }

  // Provision a real customer workspace through the real admin endpoint.
  const provision = await call("POST", "/v1/admin/workspaces", {
    headers: { "x-admin-key": ADMIN_KEY },
    body: { workspaceId: "reset-co", name: "Reset Co" }
  });
  assertEqual(provision.status, 201, "Workspace provisioned for the reset test");
  const workspaceId = provision.json.workspaceId as string;
  const apiKey = provision.json.apiKey as string;

  const auth = (extra: Record<string, string> = {}) => ({
    "x-workspace-id": workspaceId, "x-api-key": apiKey, ...extra
  });

  // ---- seed business data, an employee login, grants and an employee row ----
  const employeePasswordHash = scryptHashSync("Employee!2026");

  const permissionSync = await call("POST", "/v1/admin/permissions/sync", {
    headers: auth(),
    body: {
      profiles: [{ id: 1, name: "Sales", description: "test", is_system: 1 }],
      profilePermissions: [
        { profile_id: 1, permission_key: "orders.view", allowed: 1 },
        { profile_id: 1, permission_key: "orders.edit", allowed: 1 }
      ],
      userPermissions: []
    }
  });
  assertEqual(permissionSync.status, 200, "Permission profile seeded centrally");

  const userCreate = await call("POST", "/v1/users", {
    headers: auth(),
    body: {
      username: "employee1", password_hash: employeePasswordHash, user_type: "employee",
      status: "active", permission_profile_id: 1
    }
  });
  assertTrue(userCreate.status === 200 || userCreate.status === 201, "Employee login created centrally");

  for (const [collection, record] of [
    ["products", { id: "dev1:products:1", product_id: "PRD-1", name: "Widget", price: 10, stock: 5, category: "General" }],
    ["customers", { id: "dev1:customers:1", customer_id: "CUS-1", name: "Acme", phone: "123", email: "a@b.c", address: "Street" }],
    ["orders", { id: "dev1:orders:1", order_id: "ORD-1", customer_name: "Acme", product_name: "Widget", quantity: 2, price: 10, total: 20, status: "Pending" }],
    ["invoices", { id: "dev1:invoices:1", invoice_id: "INV-1", customer_name: "Acme", total: 20, due: 0, status: "Paid" }],
    ["employees", { id: "dev1:employees:1", employee_number: "EMP-1", first_name: "Amina", last_name: "Rahman", employment_status: "active" }]
  ] as const) {
    const created = await call("POST", `/v1/data/${collection}`, { headers: auth(), body: record });
    assertTrue(created.status === 200 || created.status === 201, `Seeded central ${collection} record`);
  }

  assertEqual(await (await fetch(`${worker.url}/v1/workspace`, { headers: auth() })).json().then((b: any) => b.resetEpoch), 0, "A never-reset workspace starts at epoch 0");

  // ---- 1. authorisation ----
  const noKey = await call("POST", "/v1/admin/reset", {
    headers: { "x-workspace-id": workspaceId },
    body: { scope: "business", confirm: workspaceId }
  });
  assertEqual(noKey.status, 401, "SECURITY: central reset refused without any credential");

  const login = await call("POST", "/v1/auth/login", {
    headers: { "x-workspace-id": workspaceId },
    body: { username: "employee1", password: "Employee!2026" }
  });
  assertEqual(login.status, 200, "Employee can sign in centrally");
  const employeeToken = login.json.token as string;

  const employeeReset = await call("POST", "/v1/admin/reset", {
    headers: { "x-workspace-id": workspaceId, authorization: `Bearer ${employeeToken}` },
    body: { scope: "business", confirm: workspaceId }
  });
  assertEqual(employeeReset.status, 403, "SECURITY: an employee session cannot reset central data even with a valid token");

  const wrongConfirm = await call("POST", "/v1/admin/reset", {
    headers: auth(),
    body: { scope: "business", confirm: "some-other-workspace" }
  });
  assertEqual(wrongConfirm.status, 400, "SECURITY: a mismatched confirmation deletes nothing");

  const afterFailedAttempts = await call("GET", "/v1/data/products", { headers: auth() });
  assertEqual(afterFailedAttempts.json?.rows?.length, 1, "No data was deleted by the refused reset attempts");

  // ---- 2. the real reset ----
  const reset = await call("POST", "/v1/admin/reset", {
    headers: auth(),
    body: { scope: "business", confirm: workspaceId }
  });
  assertEqual(reset.status, 200, "Owner API key performs the central reset");
  assertEqual(reset.json.resetEpoch, 1, "Reset bumps the workspace epoch to 1");
  assertEqual(reset.json.deleted.products, 1, "Reset reports the products row it deleted");

  for (const collection of ["products", "customers", "orders", "invoices"]) {
    const listing = await call("GET", `/v1/data/${collection}`, { headers: auth() });
    assertEqual(listing.json?.rows?.length, 0, `Central ${collection} is empty after the reset`);
  }

  // Preserved on purpose: logins, grants, employee records, settings.
  const usersAfter = await call("GET", "/v1/users", { headers: auth() });
  assertEqual(usersAfter.json?.length, 1, "Employee login survives the central reset");
  const employeeAfter = await call("GET", "/v1/data/employees", { headers: auth() });
  assertEqual(employeeAfter.json?.rows?.length, 1, "Employee records survive the central reset");
  const permsAfter = await call("GET", "/v1/me/permissions", { headers: { authorization: `Bearer ${employeeToken}` } });
  assertEqual(permsAfter.status, 200, "Employee session still works after the central reset");
  assertTrue((permsAfter.json?.permissions || []).includes("orders.edit"), "Permission grants survive the central reset");

  const resetAudit = shim.raw.prepare("SELECT COUNT(*) AS n FROM workspace_resets WHERE workspace_id=? AND reset_epoch=1").get(workspaceId) as { n: number };
  assertEqual(resetAudit.n, 1, "The reset is recorded in workspace_resets");

  // ---- 3. stale devices cannot resurrect the deleted rows ----
  const staleWrite = await call("POST", "/v1/data/products", {
    headers: auth({ "x-reset-epoch": "0" }),
    body: { id: "dev2:products:9", product_id: "PRD-9", name: "Stale", price: 1, stock: 1 }
  });
  assertEqual(staleWrite.status, 409, "SECURITY: a device on the old epoch cannot push a pre-reset record");
  assertEqual(staleWrite.json?.error, "reset_epoch_mismatch", "The refusal is a typed reset_epoch_mismatch");

  const missingEpoch = await call("POST", "/v1/data/products", {
    headers: auth(),
    body: { id: "dev2:products:10", product_id: "PRD-10", name: "No epoch", price: 1, stock: 1 }
  });
  assertEqual(missingEpoch.status, 409, "SECURITY: once reset, writes must state their epoch");
  assertEqual(missingEpoch.json?.error, "reset_epoch_required", "The refusal is a typed reset_epoch_required");

  const readsStillWork = await call("GET", "/v1/data/products", { headers: auth({ "x-reset-epoch": "0" }) });
  assertEqual(readsStillWork.status, 200, "A stale device can still READ so it can discover the new epoch");

  const currentWrite = await call("POST", "/v1/data/products", {
    headers: auth({ "x-reset-epoch": "1" }),
    body: { id: "dev1:products:2", product_id: "PRD-2", name: "Fresh", price: 2, stock: 2 }
  });
  assertTrue(currentWrite.status === 200 || currentWrite.status === 201, "A device on the current epoch writes normally");

  // ---- 4. the local helpers the main process calls ----
  const { getDatabase } = await import("../../src/database/database");
  const { countLocalBusinessRows, clearLocalBusinessData, clearAllSyncBookkeeping } = await import("../../electron/main/reset-service");
  getDatabase();

  const before = countLocalBusinessRows();
  assertTrue(Object.keys(before).length > 0, "Local reset preview counts every business table");
  const cleared = clearLocalBusinessData();
  assertTrue(cleared.success, "clearLocalBusinessData succeeds");
  const after = countLocalBusinessRows();
  assertEqual(Object.values(after).reduce((sum, n) => sum + n, 0), 0, "Every local business table is empty after the clear");

  clearAllSyncBookkeeping();
  const db = getDatabase();
  for (const table of ["cloud_sync_map", "sync_cursor", "sync_offline_queue"]) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    assertEqual(row.n, 0, `${table} is empty after clearAllSyncBookkeeping`);
  }

  await worker.close();

  // process.exit, like every other entry: better-sqlite3 handles and the
  // global fetch dispatcher keep Electron's event loop alive, so setting an
  // exit code alone leaves the process running until the runner's bound.
  if (failures > 0) {
    console.error(`\n${failures} CLOUD RESET CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\nALL CLOUD RESET CHECKS PASSED");
  process.exit(0);
}

main().catch((error) => {
  console.error("CLOUD RESET TEST CRASHED", error);
  process.exit(1);
});
