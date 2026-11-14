// Real-code, human-scenario regression coverage for the cloud feature:
//
//   Two INDEPENDENT MBS installations (two separate local SQLite
//   databases + separate signed license activations, exactly like two
//   different computers) are both configured with a "customer_managed"
//   personal-server cloud entitlement pointed at the SAME shared
//   server/workspace -- the real-world setup for one business running
//   MBS on two PCs against their own self-hosted cloud.
//
//   "User A" (PC A, Owner account) and "User B" (PC B, Administrator
//   account) then:
//     1. Message each other through the cloud (no shared local DB --
//        the only channel between them is the mock cloud server).
//     2. A creates a shared business record; B, on a totally separate
//        installation, sees it and edits it; A sees B's edit.
//
// Everything below drives the *actual* production code: auth-manager
// (real login/session), messaging-manager (real cross-installation
// recipient resolution), cloud-client (real HTTP calls), and
// cloud-config-service (real license-gated local config). The only
// thing replaced is the remote server itself, which is a small
// in-process HTTP server implementing the exact contract cloud-client.ts
// expects (see online-database-contract.ts) -- not a reimplementation of
// any MBS logic. Must run under a real Electron process (not plain
// Node) for the same reason as the other tests/main/entry-*.ts files:
// app.getPath("userData") and better-sqlite3's Electron-ABI binding.
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

// ---------------------------------------------------------------------
// Minimal mock of the personal/self-hosted cloud server. Implements
// exactly the endpoints cloud-client.ts calls (health, /v1/users,
// /v1/messages, /v1/data/:table) with an in-memory store, and enforces
// the same x-workspace-id / x-api-key headers a real Worker would, so
// the test also proves a wrong key is actually rejected end-to-end.
// ---------------------------------------------------------------------
function startMockCloudServer(expectedWorkspace: string, expectedApiKey: string) {
  const users = new Map<string, Record<string, unknown>>();
  const messages: Array<Record<string, unknown>> = [];
  let nextMessageId = 1;
  const dataTables = new Map<string, Map<string, Record<string, unknown>>>();
  let nextRecordId = 1;

  function table(name: string) {
    if (!dataTables.has(name)) dataTables.set(name, new Map());
    return dataTables.get(name)!;
  }

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

      if (url.pathname === "/health") {
        return send(200, { ok: true });
      }

      // Every other endpoint requires the workspace/API key headers,
      // exactly like a real deployed Worker would.
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
      const messagePatchMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)$/);
      if (messagePatchMatch && req.method === "PATCH") {
        const record = messages.find(m => m.remote_id === messagePatchMatch[1]);
        if (!record) return send(404, { error: "not_found" });
        Object.assign(record, body, { updated_at: new Date().toISOString() });
        return send(200, { success: true });
      }

      const dataCollectionMatch = url.pathname.match(/^\/v1\/data\/([^/]+)$/);
      if (dataCollectionMatch && req.method === "GET") {
        const rows = Array.from(table(dataCollectionMatch[1]).values());
        return send(200, { rows, count: rows.length });
      }
      if (dataCollectionMatch && req.method === "POST") {
        const id = String(nextRecordId++);
        table(dataCollectionMatch[1]).set(id, { id, ...body });
        return send(200, { success: true, id });
      }
      const dataRecordMatch = url.pathname.match(/^\/v1\/data\/([^/]+)\/([^/]+)$/);
      if (dataRecordMatch && req.method === "PATCH") {
        const t = table(dataRecordMatch[1]);
        const existing = t.get(dataRecordMatch[2]);
        if (!existing) return send(404, { error: "not_found" });
        t.set(dataRecordMatch[2], { ...existing, ...body });
        return send(200, { success: true });
      }
      if (dataRecordMatch && req.method === "DELETE") {
        table(dataRecordMatch[1]).delete(dataRecordMatch[2]);
        return send(200, { success: true });
      }

      send(404, { error: "no_such_route" });
    });
  });

  return new Promise<{ url: string; close: () => Promise<void>; dataTables: typeof dataTables }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
        dataTables
      });
    });
  });
}

async function main() {

  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) {
      failures++;
      console.error("FAIL:", label);
    } else {
      console.log("PASS:", label);
    }
  }

  const SHARED_WORKSPACE = "shared-family-shop";
  const SHARED_API_KEY = "shared-personal-server-key-xyz";
  const mock = await startMockCloudServer(SHARED_WORKSPACE, SHARED_API_KEY);

  // A single trusted test signing key, shared by both installations'
  // licenses -- simulating the same Activation Generator/vault that
  // issued both customers' licenses.
  const { publicKeyRaw: pub, privateKeyRaw: priv } = generateRawEd25519();
  const TEST_KEY_ID = "test-prod-multiuser-2099-01";

  const { canonicalBytes } = await import("../../electron/main/license-v2/crypto/verify");

  function signPayload(payload: Record<string, unknown>) {
    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, priv]);
    const keyObject = nodeCrypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    const signature = nodeCrypto.sign(null, canonicalBytes(payload), keyObject);
    return { payload, signature: signature.toString("base64url"), encoding: "base64url-ed25519" as const };
  }

  function customerManagedLicensePayload(customerName: string, fingerprint: string) {
    return {
      schemaVersion: 1,
      licenseId: `MBS-2099-${customerName.toUpperCase()}01`,
      productId: "mooral-business-suite",
      productSchema: "v1",
      customerName,
      companyName: "Shared Family Shop",
      licenseType: "standard",
      issueDate: new Date().toISOString(),
      expirationDate: null,
      machineFingerprint: fingerprint,
      activationStatus: "activated",
      keyId: TEST_KEY_ID,
      algorithm: "ed25519",
      createdAt: new Date().toISOString(),
      businessMode: "starter",
      // customer_managed: the license only grants the entitlement --
      // apiUrl/workspaceId/apiKey are empty here on purpose, exactly as
      // the real Activation Generator issues them.
      licensedCloudConfig: { enabled: true, mode: "customer_managed", apiUrl: "", workspaceId: "", apiKey: "" }
    };
  }

  // -----------------------------------------------------------------
  // Provision "PC A" -- User A's independent MBS installation.
  // -----------------------------------------------------------------
  const pcADir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-multiuser-pcA-"));
  app.setPath("userData", pcADir);

  const trustedKeysModule = await import("../../electron/main/license-v2/keys/trusted-keys");
  trustedKeysModule.TRUSTED_KEYS.push({
    keyId: TEST_KEY_ID,
    algorithm: "ed25519",
    publicKeyBase64: pub.toString("base64"),
    status: "active",
    environment: "production",
    note: "Test-only key injected by entry-cloud-multiuser.ts; not persisted to trusted-keys.ts."
  });

  const { getMachineFingerprint } = await import("../../electron/main/license-v2/crypto/machine-fingerprint");
  const fingerprint = getMachineFingerprint();

  const { saveActivation } = await import("../../electron/main/license-v2/storage/secure-storage");
  const { setCustomerManagedConfig, setCloudEnabledPreference, getCloudConfig } = await import("../../electron/main/cloud/cloud-config-service");
  const { getDatabase, closeDatabase } = await import("../../src/database/database");
  const { setupOwnerAccount, login, logout } = await import("../../electron/main/auth/auth-manager");

  saveActivation(JSON.stringify(signPayload(customerManagedLicensePayload("User A", fingerprint))));
  setCustomerManagedConfig({ apiUrl: mock.url, workspaceId: SHARED_WORKSPACE, apiKey: SHARED_API_KEY });
  setCloudEnabledPreference(true);

  {
    const cfg = getCloudConfig();
    assertTrue(cfg.mode === "customer_managed" && cfg.enabled === true, "PC A: customer_managed cloud config is active and enabled");
    assertTrue(cfg.apiUrl === mock.url && cfg.workspaceId === SHARED_WORKSPACE && cfg.apiKey === SHARED_API_KEY, "PC A: resolves the shared personal server details entered for this installation");
  }

  getDatabase();
  const ownerSetup = await setupOwnerAccount("usera", "CorrectHorseBatteryStaple1!");
  assertTrue(ownerSetup.success === true, "PC A: Owner account 'usera' created and session established");

  const { listMessageableRecipients, sendMessage, getInbox, getSent } = await import("../../electron/main/messaging-manager");

  // A's own installation hasn't seen B yet -- B has never synced to the
  // shared cloud users list, exactly like two PCs that have never been
  // online to the same workspace before.
  const recipientsBeforeBSeen = await listMessageableRecipients();
  assertTrue(!recipientsBeforeBSeen.some(r => r.username === "userb"), "PC A: User B is not yet a reachable recipient (B hasn't synced to the shared cloud yet)");

  // -----------------------------------------------------------------
  // Provision "PC B" -- User B's completely separate MBS installation,
  // same shared personal server/workspace.
  // -----------------------------------------------------------------
  logout();
  closeDatabase();
  const pcBDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-multiuser-pcB-"));
  app.setPath("userData", pcBDir);

  saveActivation(JSON.stringify(signPayload(customerManagedLicensePayload("User B", fingerprint))));
  setCustomerManagedConfig({ apiUrl: mock.url, workspaceId: SHARED_WORKSPACE, apiKey: SHARED_API_KEY });
  setCloudEnabledPreference(true);

  {
    const cfg = getCloudConfig();
    assertTrue(cfg.apiUrl === mock.url && cfg.workspaceId === SHARED_WORKSPACE && cfg.apiKey === SHARED_API_KEY, "PC B: independently resolves the SAME shared personal server (two installations, one business)");
  }

  getDatabase();
  const bSetup = await setupOwnerAccount("userb_temp_owner", "TempOwnerPassw0rd!");
  assertTrue(bSetup.success === true, "PC B: bootstrap Owner account created (required before any other account can exist)");

  const { createUser } = await import("../../src/repositories/user-repository");
  const { hashPassword } = await import("../../electron/main/auth/security/password");
  const userBPasswordHash = await hashPassword("UserBRealPassw0rd!");
  const userBRecord = createUser({
    user_type: "administrator",
    username: "userb",
    password_hash: userBPasswordHash,
    employee_id: null,
    permission_profile_id: null,
    created_by: bSetup.user ? bSetup.user.id : null
  });
  assertTrue(!!userBRecord, "PC B: Administrator account 'userb' created");

  const loginB = await login("userb", "UserBRealPassw0rd!", false);
  assertTrue(loginB.success === true, "PC B: User B logs in on their own installation");

  // B syncs themself to the shared cloud users list (same as opening
  // the Messages page for the first time).
  const bRecipients = await listMessageableRecipients();
  assertTrue(Array.isArray(bRecipients), "PC B: listMessageableRecipients() succeeds (also syncs B to the shared cloud users list)");

  // -----------------------------------------------------------------
  // HUMAN TEST 1: A messages B through the cloud, entirely across two
  // independent local databases.
  // -----------------------------------------------------------------
  logout();
  closeDatabase();
  app.setPath("userData", pcADir);
  getDatabase();
  const loginA = await login("usera", "CorrectHorseBatteryStaple1!", false);
  assertTrue(loginA.success === true, "PC A: User A logs back in on their own installation");

  const recipientsAfterBSeen = await listMessageableRecipients();
  const bAsRecipient = recipientsAfterBSeen.find(r => r.username === "userb");
  assertTrue(!!bAsRecipient, "PC A: User B is now a reachable recipient (B synced to the shared cloud in the previous step)");

  const sendResult = await sendMessage(bAsRecipient!.id, "Stock check", "Can you check how many size-M shirts are left?", "general", null);
  assertTrue(sendResult.success === true, "PC A: User A sends a message to User B through the cloud");

  const aSent = await getSent();
  assertTrue(aSent.some(m => m.subject === "Stock check"), "PC A: sent message appears in A's own Sent view");

  // -----------------------------------------------------------------
  // Switch to PC B and confirm the message actually arrived -- through
  // the cloud only, never through a shared local DB.
  // -----------------------------------------------------------------
  logout();
  closeDatabase();
  app.setPath("userData", pcBDir);
  getDatabase();
  const loginB2 = await login("userb", "UserBRealPassw0rd!", false);
  assertTrue(loginB2.success === true, "PC B: User B logs back in");

  const bInbox = await getInbox();
  const received = bInbox.find(m => m.subject === "Stock check");
  assertTrue(!!received, "PC B: User B receives A's message in their Inbox (cross-installation delivery via cloud)");
  assertTrue(received?.body === "Can you check how many size-M shirts are left?", "PC B: message body arrived intact");
  assertTrue(received?.sender_name === "usera", "PC B: sender is correctly attributed to User A");

  const { replyToMessage } = await import("../../electron/main/messaging-manager");
  const replyResult = await replyToMessage(received!.id, "Only 3 left, reordering today.");
  assertTrue(replyResult.success === true, "PC B: User B replies to A's message");

  // -----------------------------------------------------------------
  // Back to PC A: confirm the reply arrived.
  // -----------------------------------------------------------------
  logout();
  closeDatabase();
  app.setPath("userData", pcADir);
  getDatabase();
  await login("usera", "CorrectHorseBatteryStaple1!", false);

  const aInboxAfterReply = await getInbox();
  const reply = aInboxAfterReply.find(m => m.subject.toLowerCase().includes("re: stock check"));
  assertTrue(!!reply, "PC A: User A receives B's reply in their Inbox");
  assertTrue(reply?.body === "Only 3 left, reordering today.", "PC A: reply body arrived intact");

  // -----------------------------------------------------------------
  // HUMAN TEST 2: shared business data -- A creates a record, B (on a
  // totally separate installation) views and edits it, A sees the edit.
  // -----------------------------------------------------------------
  const { createCloudRecord, listCloudRecords, updateCloudRecord } = await import("../../electron/main/cloud/cloud-client");

  const created = await createCloudRecord("products", { name: "Size-M Shirt", sku: "SHIRT-M-01", stock: 3, price: 450 });
  assertTrue(created.success === true && !!created.id, "PC A: User A creates a shared product record in the cloud");
  const recordId = created.id;

  logout();
  closeDatabase();
  app.setPath("userData", pcBDir);
  getDatabase();
  await login("userb", "UserBRealPassw0rd!", false);

  const bView = await listCloudRecords("products");
  const bRecord = bView.rows.find((r: any) => r.id === recordId);
  assertTrue(!!bRecord, "PC B: User B, on a completely separate installation, sees the product A just created");
  assertTrue(bRecord?.stock === 3, "PC B: sees the correct stock value A entered");

  await updateCloudRecord("products", recordId, { stock: 15 });

  logout();
  closeDatabase();
  app.setPath("userData", pcADir);
  getDatabase();
  await login("usera", "CorrectHorseBatteryStaple1!", false);

  const aViewAfterEdit = await listCloudRecords("products");
  const aRecordAfterEdit = aViewAfterEdit.rows.find((r: any) => r.id === recordId);
  assertTrue(aRecordAfterEdit?.stock === 15, "PC A: User A sees B's stock update (15) reflected back");

  // -----------------------------------------------------------------
  // Security sanity check: the shared server actually enforces the
  // workspace/API key -- a wrong key must be rejected, not silently
  // accepted, proving the earlier successful calls weren't just an
  // open/no-auth mock.
  // -----------------------------------------------------------------
  setCustomerManagedConfig({ apiUrl: mock.url, workspaceId: SHARED_WORKSPACE, apiKey: "totally-wrong-key" });
  let wrongKeyRejected = false;
  try { await listCloudRecords("products"); }
  catch (error) { wrongKeyRejected = /401|unauthorized/i.test(error instanceof Error ? error.message : String(error)); }
  assertTrue(wrongKeyRejected, "Security: the shared server rejects a wrong API key instead of silently allowing access");
  // Restore the correct key so later assertions in this run aren't affected.
  setCustomerManagedConfig({ apiUrl: mock.url, workspaceId: SHARED_WORKSPACE, apiKey: SHARED_API_KEY });

  await mock.close();
  closeDatabase();
  fs.rmSync(pcADir, { recursive: true, force: true });
  fs.rmSync(pcBDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} multi-user cloud test(s) FAILED.`);
    process.exit(1);
  } else {
    console.log("\nALL MULTI-USER CLOUD TESTS PASSED");
    process.exit(0);
  }

}

main().catch((error) => {
  console.error("Test harness crashed:", error);
  process.exit(1);
});
