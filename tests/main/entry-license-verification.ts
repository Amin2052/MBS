// Real-code regression coverage for:
//   1. The exact reported bug -- a license signed with a "development"
//      environment key is rejected by a packaged (production) build with
//      "License was signed with an untrusted key (<keyId>)."
//   2. A license signed with a key MBS trusts as "production" (the fixed
//      state -- i.e. a real production Generator build/vault) IS accepted.
//   3. Tampering with any field, including the new licensedCloudConfig,
//      after signing invalidates the signature.
//   4. An entirely unknown key id is rejected.
//   5. A malformed licensedCloudConfig fails structural validation.
//   6. licenseManagerV2.getVerifiedCloudConfig() correctly derives the
//      developer-managed cloud config from a verified, stored license, and
//      cloud-config-service masks the apiKey for the renderer while still
//      returning the real value to internal (main-process-only) callers.
//
// Uses Node's own crypto to generate throwaway Ed25519 test keypairs and
// sign real LicensePayloadV1 payloads -- exercising the *actual*
// canonicalize/verifyEd25519/verifySignedLicense/findTrustedKey code paths,
// not a reimplementation of them. Must run under a real Electron process
// (not plain Node) because secure-storage.ts and license-manager.ts use
// app.getPath("userData").
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
  return {
    publicKeyRaw: publicKeyDer.subarray(publicKeyDer.length - 32),
    privateKeyRaw: privateKeyDer.subarray(privateKeyDer.length - 32)
  };
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-license-test-"));
  app.setPath("userData", tmpDir);

  const { canonicalBytes } = await import("../../electron/main/license-v2/crypto/verify");
  const { verifySignedLicense } = await import("../../electron/main/license-v2/license/verify-license");
  const { isStructurallyValidPayload } = await import("../../electron/main/license-v2/license/schema");
  const trustedKeysModule = await import("../../electron/main/license-v2/keys/trusted-keys");
  const { getMachineFingerprint } = await import("../../electron/main/license-v2/crypto/machine-fingerprint");
  const { saveActivation, clearActivation } = await import("../../electron/main/license-v2/storage/secure-storage");

  const fingerprint = getMachineFingerprint();

  function signPayload(payload: Record<string, unknown>, privateKeyRaw: Buffer) {
    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, privateKeyRaw]);
    const keyObject = nodeCrypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    const signature = nodeCrypto.sign(null, canonicalBytes(payload), keyObject);
    return { payload, signature: signature.toString("base64url"), encoding: "base64url-ed25519" as const };
  }

  function basePayload(keyId: string, overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      licenseId: "MBS-2026-ABCDEF01",
      productId: "mooral-business-suite",
      productSchema: "v1",
      customerName: "Test Customer",
      companyName: "Test Company",
      licenseType: "standard",
      issueDate: new Date().toISOString(),
      expirationDate: null,
      machineFingerprint: fingerprint,
      activationStatus: "activated",
      keyId,
      algorithm: "ed25519",
      createdAt: new Date().toISOString(),
      businessMode: "starter",
      licensedCloudConfig: {
        enabled: true,
        apiUrl: "https://cloud.example.com",
        workspaceId: "company-001",
        apiKey: "super-secret-gateway-key"
      },
      ...overrides
    };
  }

  // -----------------------------------------------------------------
  // TEST 1: reproduce the exact reported bug. A payload claiming
  // keyId "dev-2026-08" (the real committed development key id) is
  // rejected by a simulated packaged/production MBS build
  // (allowDevelopmentKeys: false), with the exact reported message --
  // regardless of the signature, because environment gating happens
  // before signature comparison. This confirms the root cause: any
  // license issued by a Generator instance tagged "development" will
  // always be rejected by a real customer build, by design.
  // -----------------------------------------------------------------
  {
    const { privateKeyRaw } = generateRawEd25519();
    const payload = basePayload("dev-2026-08");
    const signed = signPayload(payload, privateKeyRaw);
    const result = verifySignedLicense(signed, fingerprint, { allowDevelopmentKeys: false });
    assertTrue(result.status === "unknown_key", "dev-signed license rejected by production build (status)");
    assertTrue(
      result.reason === "License was signed with an untrusted key (dev-2026-08).",
      "dev-signed license rejected by production build (exact reported message)"
    );
  }

  // -----------------------------------------------------------------
  // TEST 2: the fix path. A license signed with a key MBS trusts as
  // "production" (simulating a real production Generator build/vault,
  // whose public key has been added to trusted-keys.ts) IS accepted by
  // a packaged build. This is the same code path a real regenerated
  // customer license goes through.
  // -----------------------------------------------------------------
  const { publicKeyRaw: prodPub, privateKeyRaw: prodPriv } = generateRawEd25519();
  const TEST_PROD_KEY_ID = "test-prod-2099-01";
  trustedKeysModule.TRUSTED_KEYS.push({
    keyId: TEST_PROD_KEY_ID,
    algorithm: "ed25519",
    publicKeyBase64: prodPub.toString("base64"),
    status: "active",
    environment: "production",
    note: "Test-only key injected by entry-license-verification.ts; not persisted to trusted-keys.ts."
  });

  let validSigned: ReturnType<typeof signPayload>;
  {
    const payload = basePayload(TEST_PROD_KEY_ID);
    validSigned = signPayload(payload, prodPriv);
    const result = verifySignedLicense(validSigned, fingerprint, { allowDevelopmentKeys: false });
    assertTrue(result.valid === true, "production-key-signed license accepted by production build");
    assertTrue(result.status === "valid", "production-key-signed license status is 'valid'");
    assertTrue(
      result.payload?.licensedCloudConfig?.apiKey === "super-secret-gateway-key",
      "licensedCloudConfig survives verification intact"
    );
  }

  // -----------------------------------------------------------------
  // TEST 3: tamper detection, including the new licensedCloudConfig
  // field -- changing it after signing must invalidate the signature.
  // -----------------------------------------------------------------
  {
    const tampered = JSON.parse(JSON.stringify(validSigned));
    tampered.payload.licensedCloudConfig.apiKey = "attacker-supplied-key";
    const result = verifySignedLicense(tampered, fingerprint, { allowDevelopmentKeys: false });
    assertTrue(result.valid === false, "tampered licensedCloudConfig rejected (valid=false)");
    assertTrue(result.status === "invalid_signature", "tampered licensedCloudConfig rejected (invalid_signature)");
  }
  {
    const tampered = JSON.parse(JSON.stringify(validSigned));
    tampered.payload.customerName = "Someone Else";
    const result = verifySignedLicense(tampered, fingerprint, { allowDevelopmentKeys: false });
    assertTrue(result.valid === false, "tampered customerName rejected (unrelated-field tamper also caught)");
  }

  // -----------------------------------------------------------------
  // TEST 4: entirely unknown key id.
  // -----------------------------------------------------------------
  {
    const { privateKeyRaw } = generateRawEd25519();
    const payload = basePayload("totally-unknown-key-id");
    const signed = signPayload(payload, privateKeyRaw);
    const result = verifySignedLicense(signed, fingerprint, { allowDevelopmentKeys: false });
    assertTrue(result.status === "unknown_key", "unknown key id rejected");
  }

  // -----------------------------------------------------------------
  // TEST 5: malformed licensedCloudConfig fails structural validation
  // (fails closed rather than being partially trusted).
  // -----------------------------------------------------------------
  {
    const payload = basePayload(TEST_PROD_KEY_ID, { licensedCloudConfig: { enabled: true, apiUrl: 12345, workspaceId: "x", apiKey: "y" } });
    assertTrue(isStructurallyValidPayload(payload) === false, "malformed licensedCloudConfig.apiUrl (non-string) fails structural validation");
  }

  // -----------------------------------------------------------------
  // TEST 6: end-to-end -- store the valid production-signed license via
  // the real secure-storage layer, then confirm licenseManagerV2's
  // getVerifiedCloudConfig() derives the correct config by re-verifying
  // from scratch, and that cloud-config-service masks the apiKey for the
  // renderer-facing view while still exposing it to internal callers.
  // -----------------------------------------------------------------
  {
    saveActivation(JSON.stringify(validSigned));

    const { licenseManagerV2 } = await import("../../electron/main/license-v2/license-manager");
    const cloudCfgFromLicense = licenseManagerV2.getVerifiedCloudConfig();
    assertTrue(cloudCfgFromLicense?.apiKey === "super-secret-gateway-key", "getVerifiedCloudConfig() derives apiKey from verified license");
    assertTrue(cloudCfgFromLicense?.workspaceId === "company-001", "getVerifiedCloudConfig() derives workspaceId from verified license");

    const { getCloudConfig, getCloudConfigView } = await import("../../electron/main/cloud/cloud-config-service");

    const internalView = getCloudConfig();
    assertTrue(internalView.apiKey === "super-secret-gateway-key", "internal getCloudConfig() exposes real apiKey for main-process use");

    const rendererView = getCloudConfigView();
    assertTrue(rendererView.apiKeyMasked === "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", "renderer-facing getCloudConfigView() masks the apiKey");
    // developer_managed views always carry an apiKey field (needed so the
    // same view shape also works for customer_managed mode), but for
    // developer_managed it must always be empty -- the real secret must
    // never cross IPC, masked or not.
    assertTrue(rendererView.mode === "developer_managed", "renderer-facing view reports developer_managed mode for a legacy (mode-less) license");
    assertTrue(rendererView.apiKey === "", "renderer-facing getCloudConfigView() never exposes the real apiKey in developer_managed mode");
    assertTrue(rendererView.licensed === true, "renderer-facing view reports licensed=true when a valid license grants cloud config");

    clearActivation();
  }

  // -----------------------------------------------------------------
  // TEST 6b: "customer_managed" cloud mode. The license grants only the
  // entitlement (apiUrl/workspaceId/apiKey are empty on the license
  // itself); the customer's own server details are stored locally via
  // setCustomerManagedConfig() and must be what getCloudConfig()/
  // getCloudConfigView() return -- never a value read off the license.
  // -----------------------------------------------------------------
  {
    const customerManagedPayload = basePayload(TEST_PROD_KEY_ID, {
      licensedCloudConfig: { enabled: true, mode: "customer_managed", apiUrl: "", workspaceId: "", apiKey: "" }
    });
    const customerManagedSigned = signPayload(customerManagedPayload, prodPriv);
    saveActivation(JSON.stringify(customerManagedSigned));

    const { licenseManagerV2 } = await import("../../electron/main/license-v2/license-manager");
    const cloudCfg = licenseManagerV2.getVerifiedCloudConfig();
    assertTrue(cloudCfg?.mode === "customer_managed", "getVerifiedCloudConfig() reports customer_managed mode when the license grants it");
    assertTrue(cloudCfg?.apiUrl === "" && cloudCfg?.apiKey === "", "customer_managed license itself carries no real server values");

    const { getCloudConfig, getCloudConfigView, setCustomerManagedConfig } = await import("../../electron/main/cloud/cloud-config-service");

    const beforeSave = getCloudConfig();
    assertTrue(beforeSave.mode === "customer_managed" && beforeSave.apiUrl === "", "before the customer saves anything, getCloudConfig() has no server details");

    setCustomerManagedConfig({ apiUrl: "https://my-own-server.example:9000", workspaceId: "my-workspace", apiKey: "my-own-api-key" });

    const afterSave = getCloudConfig();
    assertTrue(afterSave.apiUrl === "https://my-own-server.example:9000", "getCloudConfig() returns the customer's own locally-saved apiUrl in customer_managed mode");
    assertTrue(afterSave.apiKey === "my-own-api-key", "getCloudConfig() returns the customer's own locally-saved apiKey in customer_managed mode");

    const customerView = getCloudConfigView();
    assertTrue(customerView.mode === "customer_managed", "renderer-facing view reports customer_managed mode");
    assertTrue(customerView.apiUrl === "https://my-own-server.example:9000", "renderer-facing view exposes the customer's own apiUrl in full (it's their own data, not a shipped secret)");
    assertTrue(customerView.apiKey === "my-own-api-key", "renderer-facing view exposes the customer's own apiKey in full so it can be edited");

    clearActivation();
  }

  // -----------------------------------------------------------------
  // TEST 7: with no stored activation, getVerifiedCloudConfig() and
  // getCloudConfigView() must fail closed (no license = no config,
  // never a fallback to some default/customer-supplied value).
  // -----------------------------------------------------------------
  {
    const { licenseManagerV2 } = await import("../../electron/main/license-v2/license-manager");
    const { getCloudConfigView } = await import("../../electron/main/cloud/cloud-config-service");
    assertTrue(licenseManagerV2.getVerifiedCloudConfig() === null, "getVerifiedCloudConfig() returns null with no active license");
    const view = getCloudConfigView();
    assertTrue(view.licensed === false && view.apiKeyMasked === "", "getCloudConfigView() fails closed with no active license");
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED.`);
    process.exit(1);
  } else {
    console.log("\nAll license verification tests PASSED.");
    process.exit(0);
  }

}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
