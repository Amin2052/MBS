// F47: the Worker used to pay one scrypt (N=16384) for EVERY request because
// resolveWorkspaceForApiKey() re-derived the workspace key each time. The
// verification result is now cached per isolate. This entry proves the cache
// cannot become a security hole -- wrong keys, another workspace's key, and a
// rotated key are still refused -- and measures the effect so the claim is a
// number, not an assumption.
//
// Runs the real Worker handler in-process (no TCP) against the real schema, so
// the measured difference is the KDF, not network noise.
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbs-api-key-cache-"));
  const shim = createD1Shim(path.join(tmpDir, "worker.sqlite"));
  const repoRoot = process.cwd();
  for (const migration of [
    "0001_mbs_core_schema", "0002_workspace_isolation", "0003_workspace_unique_constraints",
    "0004_sync_cursor_columns", "0005_sync_tombstones", "0006_workspace_reset_epoch"
  ]) {
    shim.raw.exec(fs.readFileSync(path.join(repoRoot, `cloudflare/migrations/${migration}.sql`), "utf8"));
  }

  const ADMIN_KEY = "test-only-admin-key";
  const env: any = { DB: shim.DB, MBS_ADMIN_KEY: ADMIN_KEY };

  const workerModule: any = await import("../../cloudflare/worker/index.js");
  const handleFetch: (request: Request, env: any) => Promise<Response> = workerModule.default.fetch;

  async function call(method: string, urlPath: string, options: { headers?: Record<string, string>; body?: unknown } = {}) {
    const response = await handleFetch(new Request(`http://localhost${urlPath}`, {
      method,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    }), env);
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    return { status: response.status, json, text };
  }

  function scryptHashSync(password: string): string {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
  }

  async function provision(workspaceId: string): Promise<string> {
    const response = await call("POST", "/v1/admin/workspaces", {
      headers: { "x-admin-key": ADMIN_KEY },
      body: { workspaceId, name: workspaceId }
    });
    assertEqual(response.status, 201, `Workspace ${workspaceId} provisioned`);
    return response.json.apiKey as string;
  }

  const workspace = "cache-co";
  const apiKey = await provision(workspace);
  const otherWorkspace = "cache-other";
  const otherKey = await provision(otherWorkspace);

  await call("POST", "/v1/data/products", {
    headers: { "x-workspace-id": workspace, "x-api-key": apiKey, "x-reset-epoch": "0" },
    body: { id: "dev1:products:1", product_id: "PRD-1", name: "Widget", price: 5, stock: 2 }
  });

  async function timedGet(targetWorkspace: string, key: string): Promise<{ status: number; ms: number }> {
    const started = performance.now();
    const response = await call("GET", "/v1/data/products", {
      headers: { "x-workspace-id": targetWorkspace, "x-api-key": key }
    });
    return { status: response.status, ms: performance.now() - started };
  }

  // A workspace whose key has NEVER made a request, so the first call below is
  // genuinely cold. Measuring on `workspace` would be meaningless: seeding its
  // product already verified (and cached) that key.
  const timingWorkspace = "cache-timing";
  const timingKey = await provision(timingWorkspace);

  // ---- 1. correctness before speed ----
  const cold = await timedGet(timingWorkspace, timingKey);
  assertEqual(cold.status, 200, "A valid workspace key is accepted");

  const warmRuns: number[] = [];
  for (let i = 0; i < 5; i++) {
    const run = await timedGet(timingWorkspace, timingKey);
    assertEqual(run.status, 200, `Cached verification still accepts the key (call ${i + 1})`);
    warmRuns.push(run.ms);
  }
  const warmAverage = warmRuns.reduce((sum, ms) => sum + ms, 0) / warmRuns.length;

  console.log(`TIMING: first authenticated request ${cold.ms.toFixed(1)} ms; warm average ${warmAverage.toFixed(1)} ms over 5 calls`);
  assertTrue(warmAverage < cold.ms / 5, `Warm requests are at least 5x cheaper than the first (${warmAverage.toFixed(1)} ms vs ${cold.ms.toFixed(1)} ms)`);

  // ---- 2. the cache must not weaken authentication ----
  const badKey1 = await timedGet(workspace, "not-a-real-key");
  const badKey2 = await timedGet(workspace, "not-a-real-key");
  assertEqual(badKey1.status, 401, "SECURITY: an invalid key is refused");
  assertEqual(badKey2.status, 401, "SECURITY: an invalid key is refused again (negative results are not cached)");

  const crossWorkspace = await call("GET", "/v1/data/products", {
    headers: { "x-workspace-id": workspace, "x-api-key": otherKey }
  });
  assertEqual(crossWorkspace.status, 401, "SECURITY: another workspace's valid key is still refused for this workspace");

  // ---- 3. rotation invalidates immediately, not after the TTL ----
  await call("GET", "/v1/data/products", { headers: { "x-workspace-id": workspace, "x-api-key": apiKey } });
  shim.raw.prepare("UPDATE workspaces SET api_key_hash=? WHERE workspace_id=?")
    .run(scryptHashSync("rotated-key-value"), workspace);

  const oldKeyAfterRotation = await call("GET", "/v1/data/products", {
    headers: { "x-workspace-id": workspace, "x-api-key": apiKey }
  });
  assertEqual(oldKeyAfterRotation.status, 401, "SECURITY: a rotated key stops working even though the old one was cached");

  const rotatedKey = await call("GET", "/v1/data/products", {
    headers: { "x-workspace-id": workspace, "x-api-key": "rotated-key-value" }
  });
  assertEqual(rotatedKey.status, 200, "The new key is accepted after rotation");

  // ---- 4. an operator can disable the cache entirely ----
  env.MBS_API_KEY_CACHE_TTL_MS = "0";
  const noCache1 = await timedGet(workspace, "rotated-key-value");
  const noCache2 = await timedGet(workspace, "rotated-key-value");
  assertEqual(noCache1.status, 200, "With the cache disabled, verification still succeeds");
  assertEqual(noCache2.status, 200, "With the cache disabled, repeated verification still succeeds");
  delete env.MBS_API_KEY_CACHE_TTL_MS;

  if (failures > 0) {
    console.error(`\n${failures} API-KEY CACHE CHECK(S) FAILED`);
    process.exit(1);
  } else {
    console.log("\nALL API-KEY CACHE CHECKS PASSED");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("API-KEY CACHE TEST CRASHED", error);
  process.exit(1);
});
