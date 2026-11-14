// Regression coverage for the license-mode-switching gap this audit
// found: customer-managed cloud config (apiUrl/workspaceId/apiKey) is
// stored in a plain local file (cloud-customer-config.json) that is NOT
// scoped to any particular license. Nothing previously cleared it when
// the active license changed, so a stale customer's server details could
// silently survive onto a DIFFERENT customer's license activated later
// on the same installation -- a real instance of "prevent credentials
// from one customer/license being inherited by another".
//
// This test drives the REAL licenseManagerV2.activate() entry point
// (not a direct saveActivation() bypass, which is what every OTHER
// license test in this suite correctly uses for setup convenience, but
// would skip the exact code path this fix lives in) with two genuinely
// DIFFERENT signed licenses, both in customer_managed mode, and proves
// the second activation does not inherit the first's cloud config.
//
// Must run under a real Electron process for the same reason as every
// other tests/main/entry-*.ts file: better-sqlite3's Electron-ABI binding.
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import nodeCrypto from "crypto";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function generateRawEd25519(): { publicKeyRaw: Buffer; privateKeyRaw: Buffer } {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  return { publicKeyRaw: publicKeyDer.subarray(publicKeyDer.length - 32), privateKeyRaw: privateKeyDer.subarray(privateKeyDer.length - 32) };
}

async function main() {
  let failures = 0;
  function assertTrue(cond: boolean, label: string) {
    if (!cond) { failures++; console.error("FAIL:", label); }
    else { console.log("PASS:", label); }
  }
  function assertEqual(actual: unknown, expected: unknown, label: string) {
    assertTrue(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-license-switch-"));
  app.setPath("userData", tmpDir);

  const { publicKeyRaw: pub, privateKeyRaw: priv } = generateRawEd25519();
  const TEST_KEY_ID = "test-license-switch-2099-01";
  const { canonicalBytes } = await import("../../electron/main/license-v2/crypto/verify");

  function signPayload(payload: Record<string, unknown>) {
    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, priv]);
    const keyObject = nodeCrypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    const signature = nodeCrypto.sign(null, canonicalBytes(payload), keyObject);
    return { payload, signature: signature.toString("base64url"), encoding: "base64url-ed25519" as const };
  }

  function customerManagedLicensePayload(licenseId: string, customerName: string, fingerprint: string) {
    return {
      schemaVersion: 1, licenseId, productId: "mooral-business-suite", productSchema: "v1",
      customerName, companyName: customerName, licenseType: "standard", issueDate: new Date().toISOString(), expirationDate: null,
      machineFingerprint: fingerprint, activationStatus: "activated", keyId: TEST_KEY_ID, algorithm: "ed25519", createdAt: new Date().toISOString(),
      businessMode: "starter",
      // Entitlement only -- no real server values in the license itself
      // for customer_managed mode, matching cloud-config-service.ts's
      // own documented model.
      licensedCloudConfig: { enabled: true, mode: "customer_managed", apiUrl: "", workspaceId: "", apiKey: "" }
    };
  }

  const trustedKeysModule = await import("../../electron/main/license-v2/keys/trusted-keys");
  trustedKeysModule.TRUSTED_KEYS.push({
    keyId: TEST_KEY_ID, algorithm: "ed25519", publicKeyBase64: pub.toString("base64"), status: "active", environment: "production",
    note: "Test-only key injected by entry-license-mode-switch.ts; not persisted."
  });

  const { getMachineFingerprint } = await import("../../electron/main/license-v2/crypto/machine-fingerprint");
  const { licenseManagerV2 } = await import("../../electron/main/license-v2/license-manager");
  const { setCustomerManagedConfig, setCloudEnabledPreference, getCloudConfig } = await import("../../electron/main/cloud/cloud-config-service");

  const fingerprint = getMachineFingerprint();

  // -----------------------------------------------------------------
  // 1. Customer A activates with a customer_managed license and
  //    configures their own real server details.
  // -----------------------------------------------------------------
  const licenseA = customerManagedLicensePayload("MBS-2099-CUSTOMERA01", "Customer A Inc", fingerprint);
  const activateResultA = licenseManagerV2.activate(JSON.stringify(signPayload(licenseA)));
  assertTrue(activateResultA.activated === true, "Customer A's license activates successfully");

  setCustomerManagedConfig({ apiUrl: "https://customer-a-server.example.com", workspaceId: "workspace-a", apiKey: "customer-a-secret-key" });
  setCloudEnabledPreference(true);

  const configWhileA = getCloudConfig();
  assertEqual(configWhileA.apiUrl, "https://customer-a-server.example.com", "Customer A's own server config is in effect while their license is active");
  assertEqual(configWhileA.enabled, true, "Customer A's enabled preference is in effect");

  // -----------------------------------------------------------------
  // 2. A DIFFERENT license (Customer B, different licenseId) is
  //    activated on this SAME installation -- e.g. resold hardware, a
  //    demo/trial machine repurposed for a real customer, or any other
  //    legitimate reason a second, unrelated license ends up activated
  //    on the same userData directory. Customer A's server config must
  //    NOT leak into Customer B's session.
  // -----------------------------------------------------------------
  const licenseB = customerManagedLicensePayload("MBS-2099-CUSTOMERB01", "Customer B LLC", fingerprint);
  const activateResultB = licenseManagerV2.activate(JSON.stringify(signPayload(licenseB)));
  assertTrue(activateResultB.activated === true, "Customer B's (different) license activates successfully");

  const configAfterB = getCloudConfig();
  assertTrue(configAfterB.apiUrl !== "https://customer-a-server.example.com", "SECURITY: Customer B does NOT inherit Customer A's server URL");
  assertEqual(configAfterB.apiUrl, "", "Customer B starts with a genuinely clean (empty) server config");
  assertEqual(configAfterB.workspaceId, "", "SECURITY: Customer B does NOT inherit Customer A's workspace id");
  assertEqual(configAfterB.apiKey, "", "SECURITY: Customer B does NOT inherit Customer A's API key");
  assertEqual(configAfterB.enabled, false, "Customer B's enabled preference resets to off (a fresh customer hasn't configured or opted into anything yet)");

  // -----------------------------------------------------------------
  // 3. Sanity: RE-activating the SAME license (e.g. a renewal, or
  //    re-running the same activation code) must NOT wipe the
  //    customer's own already-configured settings -- only an actual
  //    identity change should trigger the clear.
  // -----------------------------------------------------------------
  setCustomerManagedConfig({ apiUrl: "https://customer-b-server.example.com", workspaceId: "workspace-b", apiKey: "customer-b-secret-key" });
  setCloudEnabledPreference(true);

  const reactivateB = licenseManagerV2.activate(JSON.stringify(signPayload(licenseB)));
  assertTrue(reactivateB.activated === true, "Re-activating Customer B's SAME license succeeds");

  const configAfterReactivateB = getCloudConfig();
  assertEqual(configAfterReactivateB.apiUrl, "https://customer-b-server.example.com", "Re-activating the SAME license preserves the customer's own already-configured server URL (not wiped just because activate() ran again)");
  assertEqual(configAfterReactivateB.enabled, true, "Re-activating the SAME license preserves the enabled preference too");

  if (failures > 0) {
    console.error(`\n${failures} LICENSE MODE SWITCH TEST(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nALL LICENSE MODE SWITCH TESTS PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error in entry-license-mode-switch.ts:", error);
  process.exit(1);
});
