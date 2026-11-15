/**
 * Online architecture verification.
 *
 * The online backend ships as a Cloudflare Worker under `cloudflare/`. This
 * script used to require a `server/` directory that this checkout does not
 * contain (the Express-style layout was replaced by the worker), so it failed
 * on a clean checkout for a reason unrelated to the code's health. It now
 * checks the files that actually ship and the contracts they must expose.
 *
 * Usage: npm run verify:online
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function check(condition, message) {
  if (condition) {
    console.log("PASS:", message);
  } else {
    console.error("FAIL:", message);
    failures.push(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const requiredFiles = [
  "cloudflare/wrangler.toml",
  "cloudflare/worker/index.js",
  "cloudflare/worker/schema.sql",
  "cloudflare/portal/index.html",
  "electron/main/cloud/cloud-client.ts",
  "electron/main/cloud/cloud-config-service.ts",
  "electron/main/cloud/online-database-contract.ts",
  "electron/main/cloud/offline-sync-queue.ts",
  "electron/main/cloud/security-hardening.ts"
];

for (const file of requiredFiles) {
  check(fs.existsSync(path.join(root, file)), `required online file exists: ${file}`);
}

if (failures.length) {
  console.error(`\nOnline architecture verification failed: ${failures.length} check(s).`);
  process.exit(1);
}

const wrangler = read("cloudflare/wrangler.toml");
const worker = read("cloudflare/worker/index.js");

check(
  /main\s*=\s*"worker\/index\.js"/.test(wrangler),
  "wrangler.toml deploys cloudflare/worker/index.js"
);
check(
  /\[\[d1_databases\]\]/.test(wrangler) && /binding\s*=\s*"DB"/.test(wrangler),
  "wrangler.toml binds a D1 database as DB"
);
check(
  /run_worker_first/.test(wrangler) && /"\/v1\/\*"/.test(wrangler),
  "wrangler.toml routes /v1/* through the worker rather than the static portal"
);
check(
  !/MBS_WORKSPACE_ID\s*=/.test(wrangler),
  "no hardcoded single workspace id in wrangler.toml (multi-tenant lookup stays request-scoped)"
);
check(
  /\/v1\/data\//.test(worker),
  "worker exposes the /v1/data/* sync endpoints the desktop client calls"
);
check(
  /\/health/.test(worker),
  "worker exposes /health for the cloud health indicator"
);

const migrations = fs
  .readdirSync(path.join(root, "cloudflare/migrations"))
  .filter(name => name.endsWith(".sql"));

check(migrations.length >= 5, `cloudflare/migrations contains the shipped schema history (${migrations.length} files)`);

if (failures.length) {
  console.error(`\nOnline architecture verification failed: ${failures.length} check(s).`);
  process.exit(1);
}

console.log("\nMBS online architecture verification: PASS");
