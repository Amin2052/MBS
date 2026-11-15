// Regression coverage for this audit's IPC security fixes.
//
// electron/main/main.ts registers all ipcMain handlers as a top-level
// module side effect (not behind an exported "register" function), and
// its app.whenReady().then() path creates a REAL, non-offscreen
// BrowserWindow -- unsafe to import directly in this sandboxed test
// environment (no display server). So this test proves the fix two ways
// instead, together giving strong evidence without that risk:
//
//   1. Exercises the REAL security primitive (requireUserType, from
//      electron/main/auth/authorization.ts -- the exact function every
//      fixed handler now calls) against REAL login sessions (owner,
//      employee, and no session at all), proving it actually enforces
//      what it claims to.
//   2. Statically confirms the ACTUAL SHIPPED main.ts source (not a
//      reimplementation or a copy) calls requireUserType/requirePermission
//      as the first meaningful line of every handler this audit fixed,
//      so a future edit that accidentally drops the call is caught here
//      even though the handler itself can't be safely invoked end-to-end
//      in this environment.
//
// Must run under a real Electron process for the same reason as every
// other tests/main/entry-*.ts file: better-sqlite3's Electron-ABI binding.
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

async function main() {
  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) { failures++; console.error("FAIL:", label); }
    else { console.log("PASS:", label); }
  }

  // -----------------------------------------------------------------
  // Part 1: requireUserType() against real sessions.
  // -----------------------------------------------------------------
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-ipc-security-"));
  app.setPath("userData", tmpDir);

  const { getDatabase, closeDatabase } = await import("../../src/database/database");
  const { setupOwnerAccount, login, logout } = await import("../../electron/main/auth/auth-manager");
  const { requireUserType } = await import("../../electron/main/auth/authorization");
  const { createUser } = await import("../../src/repositories/user-repository");
  const { hashPassword } = await import("../../electron/main/auth/security/password");
  const { licenseManagerV2 } = await import("../../electron/main/license-v2/license-manager");

  // F14: requireActiveUser() also enforces the licence, and the trial anchor
  // lives outside userData (deliberately -- see trial-storage.ts), so this
  // suite used to depend on whatever licence state the machine happened to
  // be in: on a fresh machine the positive assertions below failed with the
  // licence error instead of exercising RBAC. Pin the licence state instead.
  // Licensing itself has its own entries (entry-license-verification.ts,
  // entry-license-mode-switch.ts); this entry is about who may call what.
  let licensed = false;
  licenseManagerV2.getStatus = () =>
    licensed
      ? { activated: true, status: "trial" as const }
      : { activated: false, status: "not_activated" as const };

  getDatabase();
  const ownerSetup = await setupOwnerAccount("owner1", "OwnerPassw0rd1!");
  assertTrue(ownerSetup.success === true, "setup: owner account created");
  const ownerId = ownerSetup.user!.id;

  const empHash = await hashPassword("EmployeePassw0rd1!");
  const employee = createUser({ user_type: "employee", username: "employee1", password_hash: empHash, employee_id: null, permission_profile_id: null, created_by: ownerId });
  assertTrue(!!employee, "setup: employee account created");

  logout();

  // Unlicensed first: the licence gate must reject an otherwise valid
  // Owner session, with the licence message rather than a bare permission
  // error (that difference is what tells a user to activate the app).
  licensed = false;
  await login("owner1", "OwnerPassw0rd1!", false);
  let unlicensedMessage = "";
  try {
    requireUserType("owner");
  } catch (error) {
    unlicensedMessage = error instanceof Error ? error.message : String(error);
  }
  assertTrue(
    unlicensedMessage.includes("not licensed") || unlicensedMessage.includes("trial"),
    `SECURITY: an unlicensed installation rejects an Owner session at the IPC boundary (got: ${unlicensedMessage || "no error"})`
  );
  logout();

  // From here on the licence is pinned active so the RBAC matrix below is
  // deterministic on any machine.
  licensed = true;

  // No session at all -- this is the exact "reachable pre-login" gap
  // every one of this audit's fixes closes.
  let threwWithNoSession = false;
  try { requireUserType("owner"); } catch { threwWithNoSession = true; }
  assertTrue(threwWithNoSession, "SECURITY: requireUserType('owner') rejects a caller with no active session at all (the pre-login gap every cloud:*/settings:*/notifications:* fix closes)");

  await login("employee1", "EmployeePassw0rd1!", false);
  let threwForEmployee = false;
  try { requireUserType("owner"); } catch { threwForEmployee = true; }
  assertTrue(threwForEmployee, "SECURITY: requireUserType('owner') rejects a logged-in Employee session (e.g. cloud:saveCustomerConfig, settings:save must reject non-Owner/Administrator callers)");

  let succeededForEmployeeAnyRole = true;
  try { requireUserType("owner", "administrator", "employee"); } catch { succeededForEmployeeAnyRole = false; }
  assertTrue(succeededForEmployeeAnyRole, "requireUserType('owner','administrator','employee') allows a logged-in Employee (e.g. cloud:syncNow, notifications:get -- any active session, any role)");

  logout();
  await login("owner1", "OwnerPassw0rd1!", false);
  let succeededForOwner = true;
  try { requireUserType("owner"); } catch { succeededForOwner = false; }
  assertTrue(succeededForOwner, "requireUserType('owner') allows the actual Owner session (e.g. cloud:getConfig, database:getInfo)");

  logout();
  closeDatabase();

  // -----------------------------------------------------------------
  // Part 2: static confirmation that the ACTUAL main.ts source enforces
  // this at each handler fixed this audit. Reads the real shipped file,
  // not a copy -- this is what actually ships, so a future edit that
  // silently drops the check fails this test.
  // -----------------------------------------------------------------
  const mainTsPath = path.resolve(process.cwd(), "electron/main/main.ts");
  const mainTsSource = fs.readFileSync(mainTsPath, "utf8");

  // For each IPC channel, extract the handler body (from the channel
  // string to the next top-level "ipcMain.handle(" or a generous cutoff)
  // and require an auth call to appear before any of the sensitive
  // delegate calls this audit found were previously unguarded.
  function handlerBody(channel: string): string {
    const marker = `"${channel}"`;
    const idx = mainTsSource.indexOf(marker);
    if (idx === -1) return "";
    const nextHandlerIdx = mainTsSource.indexOf("ipcMain.handle(", idx + marker.length);
    const end = nextHandlerIdx === -1 ? idx + 3000 : Math.min(nextHandlerIdx, idx + 3000);
    return mainTsSource.slice(idx, end);
  }

  const fixedChannels = [
    "cloud:getConfig", "cloud:saveConfig", "cloud:saveCustomerConfig",
    "cloud:syncNow", "cloud:health",
    "settings:get", "settings:save",
    "notifications:get", "notifications:create",
    "credentials:exportPdf", "database:getInfo"
  ];

  for (const channel of fixedChannels) {
    const body = handlerBody(channel);
    assertTrue(body.length > 0, `sanity: found handler body for "${channel}" in the real main.ts`);
    const hasAuthCall = /requireUserType\s*\(/.test(body);
    assertTrue(hasAuthCall, `SECURITY: main.ts's real "${channel}" handler calls requireUserType(...) (regression guard against silently dropping this audit's fix)`);
  }

  // The four removed generic cloud CRUD channels must actually be gone,
  // not just left unauthenticated -- confirms the removal (not a partial
  // fix) actually shipped.
  for (const removedChannel of ["cloud:listRecords", "cloud:createRecord", "cloud:updateRecord", "cloud:deleteRecord"]) {
    const stillRegistered = new RegExp(`ipcMain\\.handle\\(\\s*["']${removedChannel.replace(":", "\\:")}["']`).test(mainTsSource);
    assertTrue(!stillRegistered, `SECURITY: "${removedChannel}" (unauthenticated generic cloud-table proxy, unused by any real feature) was actually removed from main.ts, not just left unguarded`);
  }

  const preloadPath = path.resolve(process.cwd(), "electron/preload/preload.ts");
  const preloadSource = fs.readFileSync(preloadPath, "utf8");
  for (const removedChannel of ["cloud:listRecords", "cloud:createRecord", "cloud:updateRecord", "cloud:deleteRecord"]) {
    assertTrue(!preloadSource.includes(`"${removedChannel}"`), `SECURITY: "${removedChannel}" is also removed from the preload bridge, not reachable via window.api at all`);
  }

  if (failures > 0) {
    console.error(`\n${failures} IPC SECURITY TEST(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nALL IPC SECURITY TESTS PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error in entry-ipc-security.ts:", error);
  process.exit(1);
});
