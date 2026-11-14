import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const keysPath = path.join(root, "electron/main/license-v2/keys/trusted-keys.ts");
const keys = fs.readFileSync(keysPath, "utf8");

if (keys.includes("<production public key base64>")) {
  console.error("Release blocked: production public key has not been provisioned in trusted-keys.ts.");
  process.exit(1);
}
if (!/keyId:\s*["']prod-\d{4}-\d{2}["']/.test(keys)) {
  console.error("Release blocked: no prod-YYYY-MM trusted signing key is configured.");
  process.exit(1);
}

// Every entry in TRUSTED_KEYS must be explicitly tagged development or
// production -- an untagged/mistagged key would defeat the runtime
// dev/production gate in findTrustedKey(). This is a coarse but
// deliberate static check: count keyId occurrences vs environment
// occurrences *within the TRUSTED_KEYS array body only* (excluding the
// TrustedKey interface's own `environment: "development" | "production"`
// type declaration) so a key added without an `environment` field is
// caught here rather than silently falling through to the TS compiler.
const arrayBodyMatch = keys.match(/export const TRUSTED_KEYS[^=]*=\s*\[([\s\S]*?)\];/);
const arrayBody = arrayBodyMatch ? arrayBodyMatch[1] : "";
const keyIdCount = (arrayBody.match(/keyId:\s*["'][^"']+["']/g) ?? []).length;
const envCount = (arrayBody.match(/environment:\s*["'](development|production)["']/g) ?? []).length;
if (keyIdCount === 0 || envCount !== keyIdCount) {
  console.error(
    `Release blocked: every TRUSTED_KEYS entry must have an explicit environment field (found ${keyIdCount} key(s), ${envCount} environment tag(s)).`
  );
  process.exit(1);
}

// findTrustedKey() must default to rejecting development keys
// (fail-safe), not default to trusting them.
if (!keys.includes("allowDevelopmentKeys: false")) {
  console.error("Release blocked: findTrustedKey() no longer defaults to rejecting development keys.");
  process.exit(1);
}

// license-manager.ts and revocation.ts must derive dev-key trust from
// app.isPackaged, not a hard-coded true -- this is the actual
// production/development boundary. If a future edit hard-codes
// `allowDevelopmentKeys: true` anywhere in main, that would let a
// packaged build trust the dev signing key, so fail the release.
const mainFiles = [
  "electron/main/license-v2/license-manager.ts",
  "electron/main/license-v2/license/revocation.ts"
];
for (const rel of mainFiles) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  if (!src.includes("app.isPackaged")) {
    console.error(`Release blocked: ${rel} does not gate development-key trust on app.isPackaged.`);
    process.exit(1);
  }
  if (/allowDevelopmentKeys:\s*true/.test(src)) {
    console.error(`Release blocked: ${rel} hard-codes allowDevelopmentKeys: true.`);
    process.exit(1);
  }
}

console.log("Release signing configuration OK.");
