import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "server/index.js",
  "electron/main/cloud/cloud-client.ts",
  "electron/main/cloud/cloud-config-service.ts",
  "electron/main/cloud/online-database-contract.ts",
];
const missing = required.filter(p => !fs.existsSync(path.join(root, p)));
if (missing.length) {
  console.error("Missing:", missing.join(", "));
  process.exit(1);
}
console.log("MBS online architecture verification: PASS");
