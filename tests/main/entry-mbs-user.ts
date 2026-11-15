// MBS-user: the employee client driving the ACTUAL Worker
// (cloudflare/worker/index.js) over real HTTP against a real SQLite database
// with the real migrations. The client under test is the exact module the
// Electron app's main process imports (mbs-user/shared/api-client.ts), so
// these assertions are about shipped code.
//
// Covered: employee sign-in, effective grants, a permitted read, a denied
// read, a permitted order-status write, optimistic-concurrency conflict,
// administrator-facing endpoints being unreachable from an employee session,
// permission revocation taking effect, account disabling ending the session,
// and logout invalidating the token.
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import { createD1Shim } from "./helpers/d1-shim";
import { startRealWorkerServer } from "./helpers/real-worker-http-server";
import {
  EmployeeClient, ApiError, SessionExpiredError, RevisionConflictError, hasPermission
} from "../../mbs-user/shared/api-client";

async function main() {
  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) { failures++; console.error("FAIL:", label); }
    else { console.log("PASS:", label); }
  }
  function assertEqual(actual: unknown, expected: unknown, label: string) {
    assertTrue(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-user-client-"));
  const shim = createD1Shim(path.join(tmpDir, "worker.sqlite"));
  const repoRoot = process.cwd();
  for (const migration of [
    "0001_mbs_core_schema", "0002_workspace_isolation", "0003_workspace_unique_constraints",
    "0004_sync_cursor_columns", "0005_sync_tombstones", "0006_workspace_reset_epoch"
  ]) {
    shim.raw.exec(fs.readFileSync(path.join(repoRoot, `cloudflare/migrations/${migration}.sql`), "utf8"));
  }

  const ADMIN_KEY = "test-only-admin-key";
  const worker = await startRealWorkerServer({ DB: shim.DB, MBS_ADMIN_KEY: ADMIN_KEY });

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
    try { json = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    return { status: response.status, json, text };
  }

  const provision = await call("POST", "/v1/admin/workspaces", {
    headers: { "x-admin-key": ADMIN_KEY },
    body: { workspaceId: "employee-co", name: "Employee Co" }
  });
  assertEqual(provision.status, 201, "Workspace provisioned for the employee-client test");
  const workspaceId = provision.json.workspaceId as string;
  const apiKey = provision.json.apiKey as string;

  const auth = (extra: Record<string, string> = {}) => ({ "x-workspace-id": workspaceId, "x-api-key": apiKey, ...extra });
  const passwordHash = scryptHashSync("Employee!2026");

  await call("POST", "/v1/admin/permissions/sync", {
    headers: auth(),
    body: {
      profiles: [{ id: 1, name: "Sales", description: "test", is_system: 1 }],
      profilePermissions: [
        { profile_id: 1, permission_key: "dashboard.view", allowed: 1 },
        { profile_id: 1, permission_key: "orders.view", allowed: 1 },
        { profile_id: 1, permission_key: "orders.edit", allowed: 1 },
        { profile_id: 1, permission_key: "customers.view", allowed: 1 }
      ],
      userPermissions: []
    }
  });

  const createdUser = await call("POST", "/v1/users", {
    headers: auth(),
    body: {
      username: "employee1", password_hash: passwordHash, user_type: "employee",
      status: "active", permission_profile_id: 1
    }
  });
  assertTrue(createdUser.status === 200 || createdUser.status === 201, "Employee account created centrally");

  const seededOrder = await call("POST", "/v1/data/orders", {
    headers: auth(),
    body: {
      id: "dev1:orders:1", order_id: "ORD-100", customer_id: "CUS-1", customer_name: "Acme",
      product_id: "PRD-1", product_name: "Widget", quantity: 2, price: 10, total: 20, status: "Pending"
    }
  });
  assertTrue(seededOrder.status === 200 || seededOrder.status === 201, "Order seeded centrally");

  const client = new EmployeeClient({ baseUrl: worker.url, workspaceId });

  // ---- 1. sign-in ----
  let wrongPasswordFailed = false;
  try {
    await client.login("employee1", "not-the-password");
  } catch (error) {
    wrongPasswordFailed = error instanceof ApiError && error.status === 401;
  }
  assertTrue(wrongPasswordFailed, "SECURITY: an incorrect password is refused with 401");

  const session = await client.login("employee1", "Employee!2026");
  assertTrue(session.token.length >= 32, "Sign-in returns a real session token");
  assertEqual(session.user.username, "employee1", "Session identifies the employee");
  assertEqual(session.user.userType, "employee", "Session carries the employee role");
  assertEqual(session.unrestricted, false, "An employee session is permission-scoped, not unrestricted");
  assertTrue(session.permissions.includes("orders.edit"), "Effective grants include orders.edit");
  assertTrue(hasPermission(session, "orders.view"), "hasPermission allows a granted module");
  assertTrue(!hasPermission(session, "products.view"), "hasPermission refuses an ungranted module");

  // ---- 2. reads ----
  const orders = await client.list(session.token, "orders");
  assertEqual(orders.length, 1, "Employee can read orders");
  assertEqual(orders[0].order_id, "ORD-100", "The central order reaches the employee client");

  let productsDenied = false;
  try {
    await client.list(session.token, "products");
  } catch (error) {
    productsDenied = error instanceof ApiError && error.status === 403;
  }
  assertTrue(productsDenied, "SECURITY: the Worker refuses an ungranted read even though the client asked for it directly");

  // ---- 3. the one write ----
  const revision = Number(orders[0].sync_revision) || 1;
  const update = await client.updateOrderStatus(session.token, String(orders[0].local_id), "Completed", revision);
  assertTrue(update.syncRevision > revision, "Order status update advances the sync revision");

  const verify = await call("GET", "/v1/data/orders", { headers: auth() });
  assertEqual(verify.json?.rows?.[0]?.status, "Completed", "The owner's copy of the order shows the employee's change");

  let conflictDetected = false;
  try {
    await client.updateOrderStatus(session.token, String(orders[0].local_id), "Cancelled", revision);
  } catch (error) {
    conflictDetected = error instanceof RevisionConflictError;
  }
  assertTrue(conflictDetected, "SECURITY: a stale revision is rejected as a conflict, never silently overwritten");

  let unknownStatusRefused = false;
  try {
    await client.updateOrderStatus(session.token, String(orders[0].local_id), "Delivered-ish", update.syncRevision);
  } catch (error) {
    unknownStatusRefused = error instanceof ApiError && error.code === "invalid_status";
  }
  assertTrue(unknownStatusRefused, "The client refuses an order status the main app does not know");

  // ---- 4. employees cannot reach administrator surfaces ----
  const usersAsEmployee = await call("GET", "/v1/users", {
    headers: { "x-workspace-id": workspaceId, authorization: `Bearer ${session.token}` }
  });
  assertEqual(usersAsEmployee.status, 403, "SECURITY: an employee session cannot list user accounts");
  const resetAsEmployee = await call("POST", "/v1/admin/reset", {
    headers: { "x-workspace-id": workspaceId, authorization: `Bearer ${session.token}` },
    body: { scope: "business", confirm: workspaceId }
  });
  assertEqual(resetAsEmployee.status, 403, "SECURITY: an employee session cannot reset central data");

  // ---- 5. the owner changes permissions: MBS-user follows ----
  await call("POST", "/v1/admin/permissions/sync", {
    headers: auth(),
    body: {
      profiles: [{ id: 1, name: "Sales", description: "test", is_system: 1 }],
      profilePermissions: [
        { profile_id: 1, permission_key: "dashboard.view", allowed: 1 },
        { profile_id: 1, permission_key: "orders.view", allowed: 1 },
        { profile_id: 1, permission_key: "orders.edit", allowed: 0 }
      ],
      userPermissions: []
    }
  });

  const refreshed = await client.permissions(session.token);
  assertTrue(!refreshed.permissions.includes("orders.edit"), "Permission refresh reflects the owner removing orders.edit");

  let editNowDenied = false;
  try {
    await client.updateOrderStatus(session.token, String(orders[0].local_id), "Pending", update.syncRevision);
  } catch (error) {
    editNowDenied = error instanceof ApiError && error.status === 403;
  }
  assertTrue(editNowDenied, "SECURITY: the revoked write is refused by the Worker on the very next request");

  // ---- 6. disabling the account ends the session ----
  const disable = await call("POST", "/v1/users", {
    headers: auth(),
    body: {
      username: "employee1", password_hash: passwordHash, user_type: "employee",
      status: "disabled", permission_profile_id: 1
    }
  });
  assertTrue(disable.status === 200 || disable.status === 201, "Owner can disable the employee account");

  let disabledEndedSession = false;
  try {
    await client.permissions(session.token);
  } catch (error) {
    disabledEndedSession = error instanceof SessionExpiredError;
  }
  assertTrue(disabledEndedSession, "SECURITY: a disabled employee's existing token stops working immediately");

  let disabledCannotSignIn = false;
  try {
    await client.login("employee1", "Employee!2026");
  } catch (error) {
    disabledCannotSignIn = error instanceof ApiError && error.status === 401;
  }
  assertTrue(disabledCannotSignIn, "SECURITY: a disabled employee cannot sign in again");

  // ---- 7. re-enabled account + logout ----
  await call("POST", "/v1/users", {
    headers: auth(),
    body: {
      username: "employee1", password_hash: passwordHash, user_type: "employee",
      status: "active", permission_profile_id: 1
    }
  });

  const secondSession = await client.login("employee1", "Employee!2026");
  assertTrue(Boolean(secondSession.token), "Re-enabled employee can sign in again");
  await client.logout(secondSession.token);

  let logoutInvalidated = false;
  try {
    await client.permissions(secondSession.token);
  } catch (error) {
    logoutInvalidated = error instanceof SessionExpiredError;
  }
  assertTrue(logoutInvalidated, "SECURITY: logout revokes the token server-side");

  const badWorkspace = new EmployeeClient({ baseUrl: worker.url, workspaceId: "not-this-workspace" });
  let wrongWorkspaceRefused = false;
  try {
    await badWorkspace.login("employee1", "Employee!2026");
  } catch (error) {
    wrongWorkspaceRefused = error instanceof ApiError && error.status === 401;
  }
  assertTrue(wrongWorkspaceRefused, "SECURITY: the same credentials are refused for another workspace id");

  await worker.close();

  // process.exit, like every other entry: the SQLite handle keeps Electron's
  // event loop alive, so an exit code alone would leave this process running
  // until the runner's session bound and report a false TIMEOUT.
  if (failures > 0) {
    console.error(`\n${failures} MBS-USER CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\nALL MBS-USER CHECKS PASSED");
  process.exit(0);
}

main().catch((error) => {
  console.error("MBS-USER TEST CRASHED", error);
  process.exit(1);
});
