// Regression coverage for a real, severe bug found this session while
// auditing backup/restore/reset alongside the new bidirectional cloud
// sync engine: performErpReset()/performFactoryReset() deleted business
// data rows WITHOUT clearing their cloud_sync_map/sync_cursor/
// sync_offline_queue entries. Since SQLite's AUTOINCREMENT never reuses
// row ids, every leftover mapping pointed at a row that genuinely no
// longer existed -- and cloud-sync-manager.ts's syncTable() explicitly
// treats "a mapped row that no longer exists locally" as "the user
// deleted this record, push a DELETE to the cloud". Left unfixed, an
// ERP Reset on ONE device would silently propagate as a full data wipe
// to every OTHER device synced to the same company workspace on their
// next sync cycle.
//
// This test proves the fix: create + push a product (real mapping
// recorded against a real cloud record), perform an ERP reset, then
// sync again -- the cloud record must survive untouched, not be deleted.
//
// Must run under a real Electron process for the same reason as every
// other tests/main/entry-*.ts file: better-sqlite3's Electron-ABI binding.
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import nodeCrypto from "crypto";
import { createD1Shim } from "./helpers/d1-shim";
import { startRealWorkerServer } from "./helpers/real-worker-http-server";

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

  const workerTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-reset-sync-worker-"));
  const shim = createD1Shim(path.join(workerTmpDir, "worker.sqlite"));
  const repoRoot = process.cwd();
  // 0003 recreates company_settings per workspace; without it the old
  // `CHECK (id = 1)` singleton schema rejects this workspace's settings row.
  for (const migration of ["0001_mbs_core_schema", "0002_workspace_isolation", "0003_workspace_unique_constraints", "0004_sync_cursor_columns", "0005_sync_tombstones"]) {
    shim.raw.exec(fs.readFileSync(path.join(repoRoot, `cloudflare/migrations/${migration}.sql`), "utf8"));
  }
  const ADMIN_KEY = "test-only-admin-key";
  const env: any = { DB: shim.DB, MBS_CORS_ORIGIN: "http://localhost", MBS_ADMIN_KEY: ADMIN_KEY };
  const worker = await startRealWorkerServer(env);

  const workspaceResponse = await fetch(`${worker.url}/v1/admin/workspaces`, {
    method: "POST", headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY }, body: JSON.stringify({ workspaceId: "reset-test-co", name: "Reset Test Co" })
  });
  const { apiKey: API_KEY } = await workspaceResponse.json() as { apiKey: string };
  const WORKSPACE = "reset-test-co";

  const { publicKeyRaw: pub, privateKeyRaw: priv } = generateRawEd25519();
  const TEST_KEY_ID = "test-reset-sync-2099-01";
  const { canonicalBytes } = await import("../../electron/main/license-v2/crypto/verify");
  function signPayload(payload: Record<string, unknown>) {
    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, priv]);
    const keyObject = nodeCrypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    const signature = nodeCrypto.sign(null, canonicalBytes(payload), keyObject);
    return { payload, signature: signature.toString("base64url"), encoding: "base64url-ed25519" as const };
  }
  function licensePayload(fingerprint: string) {
    return {
      schemaVersion: 1, licenseId: "MBS-2099-RESETSYNC01", productId: "mooral-business-suite", productSchema: "v1",
      customerName: "Reset Test Co", companyName: "Reset Test Co", licenseType: "standard", issueDate: new Date().toISOString(), expirationDate: null,
      machineFingerprint: fingerprint, activationStatus: "activated", keyId: TEST_KEY_ID, algorithm: "ed25519", createdAt: new Date().toISOString(),
      businessMode: "starter", licensedCloudConfig: { enabled: true, mode: "customer_managed", apiUrl: "", workspaceId: "", apiKey: "" }
    };
  }

  const trustedKeysModule = await import("../../electron/main/license-v2/keys/trusted-keys");
  trustedKeysModule.TRUSTED_KEYS.push({
    keyId: TEST_KEY_ID, algorithm: "ed25519", publicKeyBase64: pub.toString("base64"), status: "active", environment: "production",
    note: "Test-only key injected by entry-reset-sync-safety.ts; not persisted."
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-reset-sync-pc-"));
  app.setPath("userData", tmpDir);

  const { getMachineFingerprint } = await import("../../electron/main/license-v2/crypto/machine-fingerprint");
  const { saveActivation } = await import("../../electron/main/license-v2/storage/secure-storage");
  const { setCustomerManagedConfig, setCloudEnabledPreference } = await import("../../electron/main/cloud/cloud-config-service");
  const { getDatabase, closeDatabase } = await import("../../src/database/database");
  const { createProduct, getProducts } = await import("../../src/repositories/product-repository");
  const { syncCloudNow } = await import("../../electron/main/cloud/cloud-sync-manager");
  const { getMappingByLocalRow, listOfflineQueue, getSyncCursor, enqueueOfflineOperation } = await import("../../src/repositories/cloud-sync-repository");
  const { performErpReset, performFactoryReset } = await import("../../electron/main/reset-service");

  saveActivation(JSON.stringify(signPayload(licensePayload(getMachineFingerprint()))));
  setCustomerManagedConfig({ apiUrl: worker.url, workspaceId: WORKSPACE, apiKey: API_KEY });
  setCloudEnabledPreference(true);
  const db = getDatabase();

  // 1. Create and push a real product -- a real cloud record, a real mapping.
  createProduct({ name: "Survivor Widget", category: "Hardware", sku: "SURV-1", price: 12, stock: 5 });
  await syncCloudNow();

  const cloudBeforeReset = await fetch(`${worker.url}/v1/data/products`, { headers: { "x-workspace-id": WORKSPACE, "x-api-key": API_KEY } });
  const cloudBeforeResetBody = await cloudBeforeReset.json() as { rows: any[] };
  const survivorBefore = cloudBeforeResetBody.rows.find((r: any) => r.sku === "SURV-1");
  assertTrue(!!survivorBefore, "sanity: the product genuinely reached the cloud before reset");

  const localProduct = getProducts().find(p => p.sku === "SURV-1");
  assertTrue(!!localProduct, "sanity: product exists locally before reset");
  const mappingBeforeReset = getMappingByLocalRow("products", localProduct!.id!);
  assertTrue(!!mappingBeforeReset, "sanity: a real cloud_sync_map mapping was recorded for the pushed product");
  assertTrue(getSyncCursor("products") !== "1970-01-01T00:00:00.000Z", "sanity: sync_cursor for products actually advanced from the initial push+pull cycle");

  // Also seed a fake queued offline operation for "products" directly,
  // so the offline-queue-cleared assertion below is testing something
  // real rather than an already-empty table.
  enqueueOfflineOperation({ id: "test-queued-op-products-1", collection: "products", operation: "update", payload: { cloudLocalId: mappingBeforeReset!.cloud_local_id, record: { name: "should not survive reset" }, expectedRevision: 1 } });
  assertTrue(listOfflineQueue().some(q => q.id === "test-queued-op-products-1"), "sanity: the seeded offline queue item is actually present before reset");

  // 2. Perform an ERP Reset -- wipes local business data (same action a
  //    real Owner would take on ONE device).
  const resetResult = performErpReset();
  assertTrue(resetResult.success === true, "ERP reset succeeds");
  assertEqual(getProducts().length, 0, "local products table is genuinely empty after reset");

  // 3. Directly verify the sync-state tables themselves are cleared for
  //    the reset tables -- not inferred indirectly, checked directly.
  const remainingMappings = db.prepare(`SELECT COUNT(*) AS n FROM cloud_sync_map WHERE table_name='products'`).get() as { n: number };
  assertEqual(remainingMappings.n, 0, "cloud_sync_map has ZERO remaining rows for 'products' after ERP reset");

  const remainingCursor = db.prepare(`SELECT COUNT(*) AS n FROM sync_cursor WHERE table_name='products'`).get() as { n: number };
  assertEqual(remainingCursor.n, 0, "sync_cursor row for 'products' was actually deleted (not merely unread) by ERP reset");
  assertEqual(getSyncCursor("products"), "1970-01-01T00:00:00.000Z", "getSyncCursor('products') falls back to the initial watermark after reset, since no row remains");

  const remainingQueue = db.prepare(`SELECT COUNT(*) AS n FROM sync_offline_queue WHERE collection='products'`).get() as { n: number };
  assertEqual(remainingQueue.n, 0, "sync_offline_queue has ZERO remaining rows for 'products' after ERP reset (the seeded fake queued op above is gone)");

  const mappingAfterReset = getMappingByLocalRow("products", localProduct!.id!);
  assertTrue(!mappingAfterReset, "the specific stale mapping for the pre-reset product row is gone");

  // 4. THE ACTUAL BUG THIS TEST CATCHES: sync again. Before the fix,
  //    syncTable() would see the now-nonexistent local row for the old
  //    mapping and push a real DELETE to the cloud -- silently
  //    propagating this one device's reset into deleting the whole
  //    company's cloud data. After the fix, there is nothing left to
  //    misinterpret as a deletion, so the cloud record must survive.
  await syncCloudNow();

  const cloudAfterReset = await fetch(`${worker.url}/v1/data/products`, { headers: { "x-workspace-id": WORKSPACE, "x-api-key": API_KEY } });
  const cloudAfterResetBody = await cloudAfterReset.json() as { rows: any[] };
  const survivorAfter = cloudAfterResetBody.rows.find((r: any) => r.sku === "SURV-1");
  assertTrue(!!survivorAfter, "SAFETY: the cloud record survives a LOCAL reset on this device -- was NOT deleted from the shared company workspace");
  assertEqual(survivorAfter?.name, "Survivor Widget", "SAFETY: the surviving cloud record is untouched, not corrupted");

  // -----------------------------------------------------------------
  // 5. Same proof again for performFactoryReset() specifically -- it
  //    has its own separate call site for the same clearing logic, so
  //    it needs its own direct check rather than assuming symmetry with
  //    the ERP reset path above.
  // -----------------------------------------------------------------
  createProduct({ name: "Factory Survivor", category: "Hardware", sku: "FSURV-1", price: 8, stock: 3 });
  await syncCloudNow();
  const factoryProduct = getProducts().find(p => p.sku === "FSURV-1");
  assertTrue(!!factoryProduct, "sanity: second product exists locally before factory reset");
  assertTrue(!!getMappingByLocalRow("products", factoryProduct!.id!), "sanity: second product has a real mapping before factory reset");

  const factoryResetResult = performFactoryReset();
  assertTrue(factoryResetResult.success === true, "Factory reset succeeds");

  const remainingMappingsAfterFactory = db.prepare(`SELECT COUNT(*) AS n FROM cloud_sync_map WHERE table_name='products'`).get() as { n: number };
  assertEqual(remainingMappingsAfterFactory.n, 0, "cloud_sync_map has ZERO remaining rows for 'products' after FACTORY reset too");

  await syncCloudNow();
  const cloudAfterFactoryReset = await fetch(`${worker.url}/v1/data/products`, { headers: { "x-workspace-id": WORKSPACE, "x-api-key": API_KEY } });
  const cloudAfterFactoryResetBody = await cloudAfterFactoryReset.json() as { rows: any[] };
  assertTrue(!!cloudAfterFactoryResetBody.rows.find((r: any) => r.sku === "SURV-1"), "SAFETY: the FIRST product's cloud record also survives a FACTORY reset performed later");

  closeDatabase();
  await worker.close();

  if (failures > 0) {
    console.error(`\n${failures} RESET SYNC SAFETY TEST(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nALL RESET SYNC SAFETY TESTS PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error in entry-reset-sync-safety.ts:", error);
  process.exit(1);
});
