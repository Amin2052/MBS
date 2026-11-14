// Regression coverage for the messaging-manager.ts authorization bypass:
// sendMessage() used to check listMessageableRecipients() ONLY on the
// local-only fallback path, while the cloud-dispatch branch (taken
// whenever cloud sync is enabled, i.e. normal multi-PC operation) sent
// the message with no permission check at all. That meant an Employee
// could message another Employee -- or any forged/raw recipient id
// that happened to resolve to a real username -- as long as cloud sync
// was on. This test drives the real messaging-manager.ts against a
// single installation with cloud enabled (the exact condition that
// triggered the bypass) and asserts the intended role rule:
//
//   Employee    -> Employee        FAIL
//   Employee    -> Administrator   PASS
//   Employee    -> Owner           PASS
//   Employee    -> forged/raw id   FAIL
//
// Must run under a real Electron process, same reason as the other
// tests/main/entry-*.ts files (app.getPath("userData") and
// better-sqlite3's Electron-ABI binding).
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import nodeCrypto from "crypto";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function generateRawEd25519(): { publicKeyRaw: Buffer; privateKeyRaw: Buffer } {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  return {
    publicKeyRaw: publicKeyDer.subarray(publicKeyDer.length - 32),
    privateKeyRaw: privateKeyDer.subarray(privateKeyDer.length - 32)
  };
}

// Minimal mock cloud server -- same contract as entry-cloud-multiuser.ts,
// just enough of /v1/users and /v1/messages to exercise sendMessage()'s
// cloud-dispatch branch.
function startMockCloudServer(expectedWorkspace: string, expectedApiKey: string) {
  const users = new Map<string, Record<string, unknown>>();
  const messages: Array<Record<string, unknown>> = [];
  let nextMessageId = 1;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body: any = {};
      try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { /* ignore */ }

      const url = new URL(req.url || "/", "http://localhost");
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (url.pathname === "/health") return send(200, { ok: true });

      const workspace = req.headers["x-workspace-id"];
      const apiKey = req.headers["x-api-key"];
      if (workspace !== expectedWorkspace || apiKey !== expectedApiKey) {
        return send(401, { error: "unauthorized" });
      }

      if (url.pathname === "/v1/users" && req.method === "GET") {
        return send(200, Array.from(users.values()));
      }
      if (url.pathname === "/v1/users" && req.method === "POST") {
        users.set(String(body.username), { username: body.username, full_name: body.full_name, user_type: body.user_type, status: body.status });
        return send(200, { success: true });
      }

      if (url.pathname === "/v1/messages" && req.method === "POST") {
        const remote_id = String(nextMessageId++);
        const created_at = new Date().toISOString();
        const record = { remote_id, sender_username: body.sender_username, sender_name: body.sender_name, recipient_username: body.recipient_username, subject: body.subject, body: body.body, category: body.category, is_read: 0, deleted_by_sender: 0, deleted_by_recipient: 0, created_at, updated_at: created_at };
        messages.push(record);
        return send(200, record);
      }
      if (url.pathname === "/v1/messages" && req.method === "GET") {
        const user = url.searchParams.get("user");
        return send(200, messages.filter(m => m.sender_username === user || m.recipient_username === user));
      }

      send(404, { error: "no_such_route" });
    });
  });

  return new Promise<{ url: string; close: () => Promise<void>; messages: typeof messages }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())), messages });
    });
  });
}

async function main() {

  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) { failures++; console.error("FAIL:", label); }
    else { console.log("PASS:", label); }
  }

  const WORKSPACE = "messaging-auth-test-workspace";
  const API_KEY = "messaging-auth-test-key";
  const mock = await startMockCloudServer(WORKSPACE, API_KEY);

  const { publicKeyRaw: pub, privateKeyRaw: priv } = generateRawEd25519();
  const TEST_KEY_ID = "test-messaging-auth-2099-01";

  const { canonicalBytes } = await import("../../electron/main/license-v2/crypto/verify");

  function signPayload(payload: Record<string, unknown>) {
    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, priv]);
    const keyObject = nodeCrypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    const signature = nodeCrypto.sign(null, canonicalBytes(payload), keyObject);
    return { payload, signature: signature.toString("base64url"), encoding: "base64url-ed25519" as const };
  }

  function licensePayload(fingerprint: string) {
    return {
      schemaVersion: 1,
      licenseId: "MBS-2099-MSGAUTH01",
      productId: "mooral-business-suite",
      productSchema: "v1",
      customerName: "Messaging Auth Test Co",
      companyName: "Messaging Auth Test Co",
      licenseType: "standard",
      issueDate: new Date().toISOString(),
      expirationDate: null,
      machineFingerprint: fingerprint,
      activationStatus: "activated",
      keyId: TEST_KEY_ID,
      algorithm: "ed25519",
      createdAt: new Date().toISOString(),
      businessMode: "starter",
      licensedCloudConfig: { enabled: true, mode: "customer_managed", apiUrl: "", workspaceId: "", apiKey: "" }
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-messaging-auth-"));
  app.setPath("userData", tmpDir);

  const trustedKeysModule = await import("../../electron/main/license-v2/keys/trusted-keys");
  trustedKeysModule.TRUSTED_KEYS.push({
    keyId: TEST_KEY_ID,
    algorithm: "ed25519",
    publicKeyBase64: pub.toString("base64"),
    status: "active",
    environment: "production",
    note: "Test-only key injected by entry-messaging-authorization.ts; not persisted."
  });

  const { getMachineFingerprint } = await import("../../electron/main/license-v2/crypto/machine-fingerprint");
  const fingerprint = getMachineFingerprint();

  const { saveActivation } = await import("../../electron/main/license-v2/storage/secure-storage");
  const { setCustomerManagedConfig, setCloudEnabledPreference, getCloudConfig } = await import("../../electron/main/cloud/cloud-config-service");
  const { getDatabase, closeDatabase } = await import("../../src/database/database");
  const { setupOwnerAccount, login, logout } = await import("../../electron/main/auth/auth-manager");

  saveActivation(JSON.stringify(signPayload(licensePayload(fingerprint))));
  setCustomerManagedConfig({ apiUrl: mock.url, workspaceId: WORKSPACE, apiKey: API_KEY });
  // This is the exact condition that triggered the bypass: cloud sync
  // enabled, which is the normal state for real multi-PC operation.
  setCloudEnabledPreference(true);
  assertTrue(getCloudConfig().enabled === true, "cloud sync is enabled (the condition that triggered the bypass)");

  getDatabase();
  const ownerSetup = await setupOwnerAccount("owner1", "OwnerPassw0rd1!");
  assertTrue(ownerSetup.success === true, "Owner account created");
  const ownerId = ownerSetup.user!.id;

  const { createUser } = await import("../../src/repositories/user-repository");
  const { hashPassword } = await import("../../electron/main/auth/security/password");

  const adminHash = await hashPassword("AdminPassw0rd1!");
  const admin = createUser({ user_type: "administrator", username: "admin1", password_hash: adminHash, employee_id: null, permission_profile_id: null, created_by: ownerId });
  assertTrue(!!admin, "Administrator account created");

  const emp1Hash = await hashPassword("Employee1Passw0rd!");
  const employee1 = createUser({ user_type: "employee", username: "employee1", password_hash: emp1Hash, employee_id: null, permission_profile_id: null, created_by: ownerId });
  assertTrue(!!employee1, "Employee 1 account created");

  const emp2Hash = await hashPassword("Employee2Passw0rd!");
  const employee2 = createUser({ user_type: "employee", username: "employee2", password_hash: emp2Hash, employee_id: null, permission_profile_id: null, created_by: ownerId });
  assertTrue(!!employee2, "Employee 2 account created");

  logout();

  const { sendMessage, listMessageableRecipients } = await import("../../electron/main/messaging-manager");

  // -----------------------------------------------------------------
  // Employee 1 logs in and tries to message Employee 2 -- MUST FAIL,
  // even though cloud sync is enabled (this is the exact bypass).
  // -----------------------------------------------------------------
  const loginEmp1 = await login("employee1", "Employee1Passw0rd!", false);
  assertTrue(loginEmp1.success === true, "Employee 1 logs in");

  const employeeToEmployee = await sendMessage(employee2.id, "Hey", "Off the record chat", "general", null);
  assertTrue(employeeToEmployee.success === false, "SECURITY: Employee -> Employee is blocked even with cloud sync enabled");

  // Forged/raw recipient id that doesn't correspond to anyone reachable.
  const forgedIdResult = await sendMessage(9999999, "Hi", "forged recipient", "general", null);
  assertTrue(forgedIdResult.success === false, "SECURITY: forged/raw recipient id is rejected");

  // Employee -> Administrator and Employee -> Owner must both succeed.
  const employeeToAdmin = await sendMessage(admin.id, "Question", "Can you approve this order?", "general", null);
  assertTrue(employeeToAdmin.success === true, "Employee -> Administrator is allowed");

  const employeeToOwner = await sendMessage(ownerId, "Question", "Can you approve this refund?", "general", null);
  assertTrue(employeeToOwner.success === true, "Employee -> Owner is allowed");

  // Sanity: listMessageableRecipients() itself never listed employee2
  // as reachable for employee1 in the first place.
  const employee1Recipients = await listMessageableRecipients();
  assertTrue(!employee1Recipients.some(r => r.id === employee2.id), "Employee 2 never appears in Employee 1's allowed recipient list");

  logout();
  closeDatabase();
  await mock.close();

  if (failures > 0) {
    console.error(`\n${failures} MESSAGING AUTHORIZATION TEST(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nALL MESSAGING AUTHORIZATION TESTS PASSED");
    process.exit(0);
  }

}

main().catch((error) => {
  console.error("Unhandled error in entry-messaging-authorization.ts:", error);
  process.exit(1);
});
