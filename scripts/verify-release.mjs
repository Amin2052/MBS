import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "package.json",
  "server/index.js",
  "server/security-policy.js",
  "server/role-permission-policy.js",
  "electron/main/cloud/online-database-contract.ts",
  "electron/main/cloud/role-permission-contract.ts",
  "electron/main/cloud/sync-conflict-service.ts",
  "electron/main/cloud/offline-sync-queue.ts",
  "electron/main/cloud/security-hardening.ts",
  "src/services/realtime-messaging-service.ts",
];
const missing = required.filter(p => !fs.existsSync(path.join(root,p)));
if (missing.length) {
  console.error("Release verification failed:", missing.join(", "));
  process.exit(1);
}
console.log("MBS Phase 10 release verification: PASS");
