// Drives the ACTUAL cloudflare/worker/index.js (not a reimplementation)
// against a REAL SQLite database with the REAL 0001 + 0002 migrations
// applied, via a small D1 shim (tests/main/helpers/d1-shim.ts). This is
// the strongest evidence available in this environment (no live
// Cloudflare/D1 access) that the workspace-isolation changes actually
// work against the real code and real schema, not a hand-modeled mock.
//
// Runs under Electron for the same reason as the other tests/main/entry-*.ts
// files: better-sqlite3 is rebuilt for Electron's ABI, not plain Node's.
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { createD1Shim } from "./helpers/d1-shim";

async function main() {
  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) { failures++; console.error("FAIL:", label); }
    else { console.log("PASS:", label); }
  }
  function assertEqual(actual: unknown, expected: unknown, label: string) {
    assertTrue(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-worker-tenant-"));
  app.setPath("userData", tmpDir); // unused by this test directly, but keeps parity with the other entry-*.ts files' environment assumptions

  const dbPath = path.join(tmpDir, "worker-d1-shim.sqlite");
  const shim = createD1Shim(dbPath);

  // process.cwd() is the repo root (npm run test:main / run-main-tests.mjs
  // both run from there); __dirname is unreliable here because esbuild
  // bundles this file into tests/main/.bundle/, which would resolve
  // relative paths from the wrong directory.
  const repoRoot = process.cwd();
  const migration0001 = fs.readFileSync(path.join(repoRoot, "cloudflare/migrations/0001_mbs_core_schema.sql"), "utf8");
  const migration0002 = fs.readFileSync(path.join(repoRoot, "cloudflare/migrations/0002_workspace_isolation.sql"), "utf8");
  const migration0004 = fs.readFileSync(path.join(repoRoot, "cloudflare/migrations/0004_sync_cursor_columns.sql"), "utf8");
  const migration0005 = fs.readFileSync(path.join(repoRoot, "cloudflare/migrations/0005_sync_tombstones.sql"), "utf8");
  // 0003 (relaxing global uniqueness to per-workspace) is deliberately NOT
  // applied here -- it's flagged in its own header as needing a dry run
  // against a real D1 copy first, which this test is not. That means this
  // suite cannot yet prove "same username in two workspaces" or
  // "same business code in two workspaces" succeed -- only that the
  // actual security boundary (cross-tenant read/write/delete) holds,
  // which 0002 + the Worker code changes are what's actually responsible
  // for. See .claude/multi-company-sync-checkpoint.md.
  shim.raw.exec(migration0001);
  shim.raw.exec(migration0002);
  shim.raw.exec(migration0004);
  shim.raw.exec(migration0005);

  const LEGACY_API_KEY = "legacy-shared-secret-for-mooral-main";
  const ADMIN_KEY = "test-only-admin-provisioning-key";
  const env: any = {
    DB: shim.DB,
    MBS_CORS_ORIGIN: "http://localhost",
    MBS_API_KEY: LEGACY_API_KEY, // legacy bridge, mooral-main only
    MBS_ADMIN_KEY: ADMIN_KEY
    // MBS_WORKSPACE_ID deliberately unset -- this is the multi-tenant mode
  };

  const workerModule: any = await import("../../cloudflare/worker/index.js");
  const handleFetch: (request: Request, env: any) => Promise<Response> = workerModule.default.fetch;

  async function call(method: string, urlPath: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
    const request = new Request(`http://localhost${urlPath}`, {
      method,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    const response = await handleFetch(request, env);
    const status = response.status;
    let json: any = null;
    try { json = await response.json(); } catch { /* not JSON, fine */ }
    return { status, json };
  }

  function scryptHashSync(password: string): string {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
  }

  // -----------------------------------------------------------------
  // 1. Provision two brand-new customer workspaces via the real admin
  //    endpoint -- this is the actual "Activation Generator issues a new
  //    customer" lifecycle path, not a shortcut around it.
  // -----------------------------------------------------------------
  const noAdminKey = await call("POST", "/v1/admin/workspaces", { body: { workspaceId: "company-a", name: "Company A" } });
  assertEqual(noAdminKey.status, 403, "SECURITY: workspace creation refused without the admin key");

  const reservedAttempt = await call("POST", "/v1/admin/workspaces", { headers: { "x-admin-key": ADMIN_KEY }, body: { workspaceId: "mooral-main", name: "nope" } });
  assertEqual(reservedAttempt.status, 400, "SECURITY: cannot claim the reserved legacy workspace id via provisioning");

  const createA = await call("POST", "/v1/admin/workspaces", { headers: { "x-admin-key": ADMIN_KEY }, body: { workspaceId: "company-a", name: "Company A" } });
  assertEqual(createA.status, 201, "Workspace A provisioned");
  const workspaceA = createA.json.workspaceId as string;
  const apiKeyA = createA.json.apiKey as string;
  assertTrue(typeof apiKeyA === "string" && apiKeyA.length >= 32, "Workspace A received a real generated API key");

  const createB = await call("POST", "/v1/admin/workspaces", { headers: { "x-admin-key": ADMIN_KEY }, body: { workspaceId: "company-b", name: "Company B" } });
  assertEqual(createB.status, 201, "Workspace B provisioned");
  const workspaceB = createB.json.workspaceId as string;
  const apiKeyB = createB.json.apiKey as string;

  const duplicateA = await call("POST", "/v1/admin/workspaces", { headers: { "x-admin-key": ADMIN_KEY }, body: { workspaceId: "company-a", name: "dup" } });
  assertEqual(duplicateA.status, 409, "SECURITY: cannot re-provision an existing workspace id");

  function headersFor(workspace: string, apiKey: string, extra: Record<string, string> = {}) {
    return { "x-workspace-id": workspace, "x-api-key": apiKey, ...extra };
  }

  // -----------------------------------------------------------------
  // 2. Forged / mismatched API-key <-> workspace combinations must fail.
  // -----------------------------------------------------------------
  const wrongKeyForA = await call("GET", "/v1/data/products", { headers: headersFor(workspaceA, apiKeyB) });
  assertEqual(wrongKeyForA.status, 401, "SECURITY: Company B's API key is rejected for Company A's workspace id");

  const forgedWorkspaceGuess = await call("GET", "/v1/data/products", { headers: headersFor("some-guessed-workspace-id", apiKeyA) });
  assertEqual(forgedWorkspaceGuess.status, 401, "SECURITY: Company A's real key does not work for a forged/guessed workspace id");

  const legacyKeyOnRealWorkspace = await call("GET", "/v1/data/products", { headers: headersFor(workspaceA, LEGACY_API_KEY) });
  assertEqual(legacyKeyOnRealWorkspace.status, 401, "SECURITY: the legacy shared secret does NOT work for a real per-workspace tenant");

  const legacyKeyOnLegacyWorkspace = await call("GET", "/v1/data/products", { headers: headersFor("mooral-main", LEGACY_API_KEY) });
  assertEqual(legacyKeyOnLegacyWorkspace.status, 200, "Legacy bridge: the legacy secret still works, but ONLY for mooral-main specifically");

  // -----------------------------------------------------------------
  // 3. Create real business data in both workspaces, then prove
  //    Company A cannot read/write/delete Company B's records.
  // -----------------------------------------------------------------
  const createProductA = await call("POST", "/v1/data/products", { headers: headersFor(workspaceA, apiKeyA), body: { id: "dev-a:products:1", product_id: "PRD-A-001", name: "Company A Widget", price: 10 } });
  assertEqual(createProductA.status, 201, "Company A creates a product");

  const createProductB = await call("POST", "/v1/data/products", { headers: headersFor(workspaceB, apiKeyB), body: { id: "dev-b:products:1", product_id: "PRD-B-001", name: "Company B Gadget", price: 20 } });
  assertEqual(createProductB.status, 201, "Company B creates a product");

  const listAsA = await call("GET", "/v1/data/products", { headers: headersFor(workspaceA, apiKeyA) });
  assertEqual(listAsA.status, 200, "Company A can list its own products");
  assertTrue(listAsA.json.rows.length === 1 && listAsA.json.rows[0].name === "Company A Widget", "SECURITY: Company A's product list contains ONLY Company A's product");

  const listAsB = await call("GET", "/v1/data/products", { headers: headersFor(workspaceB, apiKeyB) });
  assertTrue(listAsB.json.rows.length === 1 && listAsB.json.rows[0].name === "Company B Gadget", "SECURITY: Company B's product list contains ONLY Company B's product");

  const readBsRecordAsA = await call("GET", "/v1/data/products/dev-b:products:1", { headers: headersFor(workspaceA, apiKeyA) });
  assertEqual(readBsRecordAsA.status, 404, "SECURITY: Company A cannot read Company B's product by forged/guessed local_id");

  const updateBsRecordAsA = await call("PATCH", "/v1/data/products/dev-b:products:1", { headers: headersFor(workspaceA, apiKeyA), body: { name: "hijacked" } });
  assertEqual(updateBsRecordAsA.status, 404, "SECURITY: Company A cannot modify Company B's product");

  const deleteBsRecordAsA = await call("DELETE", "/v1/data/products/dev-b:products:1", { headers: headersFor(workspaceA, apiKeyA) });
  assertEqual(deleteBsRecordAsA.status, 404, "SECURITY: Company A cannot delete Company B's product");

  const bStillExists = await call("GET", "/v1/data/products/dev-b:products:1", { headers: headersFor(workspaceB, apiKeyB) });
  assertEqual(bStillExists.status, 200, "Company B's product survived Company A's attempted read/write/delete, untouched");

  // -----------------------------------------------------------------
  // 4. Users + login isolation.
  // -----------------------------------------------------------------
  const ownerAHash = scryptHashSync("OwnerAPassw0rd1!");
  const createOwnerA = await call("POST", "/v1/users", { headers: headersFor(workspaceA, apiKeyA), body: { username: "owner", password_hash: ownerAHash, user_type: "owner", status: "active" } });
  assertEqual(createOwnerA.status, 201, "Company A owner user created");
  const ownerAId = createOwnerA.json.id as number;

  const empAHash = scryptHashSync("EmployeeAPassw0rd1!");
  const createEmpA = await call("POST", "/v1/users", { headers: headersFor(workspaceA, apiKeyA), body: { username: "employee1", password_hash: empAHash, user_type: "employee", status: "active" } });
  assertEqual(createEmpA.status, 201, "Company A employee user created");
  const empAId = createEmpA.json.id as number;

  // NOTE: users.username is still a GLOBALLY unique column-level
  // constraint until 0003_workspace_unique_constraints.sql is applied
  // (that migration is deliberately not applied in this test -- see the
  // note above the exec() calls). So this suite documents that limitation
  // as a real, current, expected failure rather than papering over it by
  // only ever using distinct usernames per workspace.
  const ownerBHash = scryptHashSync("OwnerBPassw0rd1!");
  const collidingUsernameAcrossWorkspaces = await call("POST", "/v1/users", { headers: headersFor(workspaceB, apiKeyB), body: { username: "owner", password_hash: ownerBHash, user_type: "owner", status: "active" } });
  assertEqual(collidingUsernameAcrossWorkspaces.status, 409, "KNOWN LIMITATION (tracked, not a security gap; fails CLEANLY with a structured 409, not an unhandled exception): reusing username 'owner' in Company B currently conflicts because users.username is still globally unique pre-0003 -- fixed once 0003_workspace_unique_constraints.sql ships (see that file's header for the required dry-run steps first)");
  assertEqual(collidingUsernameAcrossWorkspaces.json.error, "username_conflict", "the 409 has a structured, machine-readable error shape (same convention as handleData's business_key_conflict)");

  const createOwnerB = await call("POST", "/v1/users", { headers: headersFor(workspaceB, apiKeyB), body: { username: "owner-b", password_hash: ownerBHash, user_type: "owner", status: "active" } });
  assertEqual(createOwnerB.status, 201, "Company B owner user created with a distinct username (workaround for the pre-0003 global-uniqueness limitation above)");
  assertTrue(createOwnerB.json.id !== ownerAId, "Company A and Company B's owner accounts are genuinely different user rows");

  const listUsersAsA = await call("GET", "/v1/users", { headers: headersFor(workspaceA, apiKeyA) });
  assertTrue(listUsersAsA.json.every((u: any) => u.username !== "employee1" || u.id === empAId), "sanity: Company A's user list shape looks right");
  assertEqual(listUsersAsA.json.length, 2, "SECURITY: Company A's /v1/users list contains ONLY Company A's 2 users, not Company B's owner too");

  const loginACorrectWorkspace = await call("POST", "/v1/auth/login", { headers: headersFor(workspaceA, apiKeyA), body: { username: "owner", password: "OwnerAPassw0rd1!" } });
  assertEqual(loginACorrectWorkspace.status, 200, "Company A owner logs in against Company A's workspace");
  const sessionTokenA = loginACorrectWorkspace.json.token as string;

  const loginWrongWorkspace = await call("POST", "/v1/auth/login", { headers: headersFor(workspaceB, apiKeyB), body: { username: "owner", password: "OwnerAPassw0rd1!" } });
  assertEqual(loginWrongWorkspace.status, 401, "SECURITY: Company A's owner credentials do not authenticate into Company B's workspace (username 'owner' doesn't even exist in B's workspace-scoped lookup)");

  const meAsA = await call("GET", "/v1/me", { headers: { authorization: `Bearer ${sessionTokenA}` } });
  assertEqual(meAsA.status, 200, "Company A owner's session works for /v1/me");
  assertEqual(meAsA.json.user.username, "owner", "sanity: /v1/me returns the right user");

  // A Bearer session for Company A must not be able to read Company B's
  // data even if the caller also somehow supplies Company B's workspace
  // header alongside it -- workspace must come from the session, not a
  // header sent alongside a valid but unrelated session.
  const sessionAWithForgedWorkspaceHeader = await call("GET", "/v1/data/products", { headers: { authorization: `Bearer ${sessionTokenA}`, "x-workspace-id": workspaceB } });
  assertEqual(sessionAWithForgedWorkspaceHeader.status, 200, "request still succeeds (session is valid)...");
  assertTrue(sessionAWithForgedWorkspaceHeader.json.rows.length === 1 && sessionAWithForgedWorkspaceHeader.json.rows[0].name === "Company A Widget", "SECURITY: ...but still returns ONLY Company A's data -- the x-workspace-id header is ignored once a Bearer session is present, workspace comes from the session's own DB row");

  // -----------------------------------------------------------------
  // 5. Messaging isolation + server-side Employee->Employee enforcement
  //    (defense in depth alongside the client-side fix in
  //    messaging-manager.ts / entry-messaging-authorization.ts).
  // -----------------------------------------------------------------
  // Username "employee-b1", not "employee1": usernames are still globally
  // unique pre-0003 (see the note above) and Company A already used
  // "employee1" -- this is the same documented, tracked limitation, not a
  // new issue.
  const empBHash = scryptHashSync("EmployeeBPassw0rd1!");
  const createEmpB = await call("POST", "/v1/users", { headers: headersFor(workspaceB, apiKeyB), body: { username: "employee-b1", password_hash: empBHash, user_type: "employee", status: "active" } });
  assertEqual(createEmpB.status, 201, "Company B employee user created");
  const empBId = createEmpB.json.id as number;

  const messageEmpAToEmpB = await call("POST", "/v1/messages", { headers: headersFor(workspaceA, apiKeyA, { "x-user": "employee1" }), body: { recipient_id: empBId, subject: "hi", body: "cross-tenant?" } });
  assertEqual(messageEmpAToEmpB.status, 404, "SECURITY: Company A employee cannot message a Company B user id, even one that legitimately exists in B (recipient lookup is workspace-scoped)");

  const messageEmpAToOwnerA = await call("POST", "/v1/messages", { headers: headersFor(workspaceA, apiKeyA, { "x-user": "employee1" }), body: { recipient_id: ownerAId, subject: "hi", body: "question for my own owner" } });
  assertEqual(messageEmpAToOwnerA.status, 201, "Company A employee CAN message Company A's own owner");

  // Create a second employee within A itself to test the same-workspace
  // Employee->Employee block server-side (the client-side block already
  // has its own dedicated regression test).
  const emp2AHash = scryptHashSync("Employee2APassw0rd1!");
  const createEmp2A = await call("POST", "/v1/users", { headers: headersFor(workspaceA, apiKeyA), body: { username: "employee2", password_hash: emp2AHash, user_type: "employee", status: "active" } });
  const emp2AId = createEmp2A.json.id as number;
  const empToEmpSameWorkspace = await call("POST", "/v1/messages", { headers: headersFor(workspaceA, apiKeyA, { "x-user": "employee1" }), body: { recipient_id: emp2AId, subject: "hi", body: "same company, still not allowed" } });
  assertEqual(empToEmpSameWorkspace.status, 403, "SECURITY: server-side Employee->Employee block holds even within the same workspace, independent of the desktop client's own check");

  const forgedXUser = await call("POST", "/v1/messages", { headers: headersFor(workspaceA, apiKeyA, { "x-user": "nonexistent-user-xyz" }), body: { recipient_id: ownerAId, subject: "hi", body: "forged sender" } });
  assertEqual(forgedXUser.status, 401, "SECURITY: a forged/nonexistent x-user sender identity is rejected, not silently trusted");

  // -----------------------------------------------------------------
  // 6. Company settings: each workspace's own row, forged-workspace read
  //    denied. (0003 not applied here -- see the note above the exec()
  //    calls -- so we only assert what 0002 alone is responsible for:
  //    mooral-main's settings and Company A's very first settings write
  //    both work in isolation; a SECOND real workspace writing settings is
  //    documented in 0003's header as needing that follow-up migration and
  //    is intentionally not asserted as passing here.)
  // -----------------------------------------------------------------
  // NOTE: a bare { company_name: "..." } payload is not actually
  // realistic here and was found (by this test, during development) to
  // 400 on a NOT NULL constraint -- handleCompanySettings binds an
  // explicit `null` for any column absent from the request body rather
  // than omitting it from the INSERT column list, so `NOT NULL DEFAULT`
  // columns (business_mode, security_max_login_attempts, etc.) need a
  // real value in the payload. This is pre-existing behavior (identical
  // in the original single-tenant code, not something the workspace
  // scoping changed) and matches how the real desktop app actually calls
  // this endpoint -- cloud-sync-manager.ts always pushes the full local
  // company_settings row, never a partial one. Supplying the NOT NULL
  // columns explicitly here for the same reason.
  const setSettingsA = await call("POST", "/v1/data/company_settings", { headers: headersFor(workspaceA, apiKeyA), body: {
    company_name: "Company A Inc", business_mode: "starter", security_max_login_attempts: 5, security_lockout_minutes: 15,
    security_session_timeout_minutes: 0, stock_low_threshold: 10, stock_allow_negative: 0, stock_auto_reorder_alert: 1,
    sales_require_approval: 0, accounting_auto_post_journal: 1, payroll_pay_day: 1, employee_probation_days: 90,
    notify_email_enabled: 1, notify_low_stock: 1, notify_order_updates: 1, notify_payment_due: 1,
    integration_enabled: 0, document_show_logo: 1
  } });
  assertEqual(setSettingsA.status, 200, "Company A writes its own company settings (first workspace to do so post-migration)");
  const getSettingsAAsB = await call("GET", "/v1/data/company_settings", { headers: headersFor(workspaceB, apiKeyB) });
  assertTrue(getSettingsAAsB.json.company_name !== "Company A Inc", "SECURITY: Company B never sees Company A's company_name when reading its own (empty) settings");

  shim.close();

  if (failures > 0) {
    console.error(`\n${failures} WORKER TENANT ISOLATION TEST(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nALL WORKER TENANT ISOLATION TESTS PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error in entry-worker-tenant-isolation.ts:", error);
  process.exit(1);
});
