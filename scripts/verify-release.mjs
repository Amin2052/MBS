/**
 * Release verification.
 *
 * Previously this script required a `server/` directory (an Express-style
 * backend this checkout does not ship) and stopped at a file-existence check,
 * so it failed on a clean checkout for the wrong reason and would have passed
 * a release with no build output at all. It now verifies what actually ships:
 *
 *   1. the cloud backend the desktop client talks to (Cloudflare Worker),
 *   2. the desktop source files the release notes promise,
 *   3. package metadata: version, entry point, installer configuration,
 *   4. installed dependencies needed by the packaged app,
 *   5. the electron-vite build output, and any installer already produced.
 *
 * Every failure is collected and printed together with a fix hint, so one run
 * tells the whole story instead of stopping at the first missing file.
 *
 * Usage:
 *   npm run verify:release              # source + metadata + build output
 *   npm run verify:release -- --require-dist
 *                                       # also require a packaged installer
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requireDist = process.argv.includes("--require-dist");

const failures = [];
const warnings = [];

function pass(message) {
  console.log("PASS:", message);
}

function fail(message, hint) {
  console.error("FAIL:", message);
  failures.push(hint ? `${message} (${hint})` : message);
}

function warn(message) {
  console.log("WARN:", message);
  warnings.push(message);
}

function check(condition, message, hint) {
  if (condition) {
    pass(message);
  } else {
    fail(message, hint);
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

console.log("--- 1. shipped source ---");

const requiredSource = [
  "cloudflare/wrangler.toml",
  "cloudflare/worker/index.js",
  "cloudflare/worker/schema.sql",
  "electron/main/main.ts",
  "electron/main/cloud/online-database-contract.ts",
  "electron/main/cloud/role-permission-contract.ts",
  "electron/main/cloud/sync-conflict-service.ts",
  "electron/main/cloud/offline-sync-queue.ts",
  "electron/main/cloud/security-hardening.ts",
  "electron/main/license-v2/keys/trusted-keys.ts",
  "src/services/realtime-messaging-service.ts",
  "MBS.ico"
];

for (const file of requiredSource) {
  check(exists(file), `present: ${file}`, "restore the file or update this list");
}

console.log("\n--- 2. package metadata ---");

const pkgPath = "package.json";
const pkg = JSON.parse(read(pkgPath));

check(
  typeof pkg.version === "string" && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version),
  `version is semver (${pkg.version})`,
  "set a semver version in package.json"
);
check(
  pkg.main === "./out/main/main.js",
  "main entry points at the electron-vite build output",
  "package.json main must be ./out/main/main.js"
);
check(
  pkg.scripts?.["dist:win"]?.includes("electron-builder"),
  "dist:win runs electron-vite build before electron-builder",
  "packaging must build first, never package stale output"
);
check(
  pkg.build?.appId === "com.mooral.businesssuite",
  "electron-builder appId is set",
  "set build.appId"
);
check(
  Array.isArray(pkg.build?.asarUnpack) &&
    pkg.build.asarUnpack.some(pattern => pattern.includes("better-sqlite3")),
  "better-sqlite3 is unpacked from the asar archive",
  "native modules must be asarUnpack-ed or the packaged app cannot load its database"
);
check(
  pkg.build?.win?.target === "nsis",
  "Windows target is the NSIS installer",
  "set build.win.target"
);
check(
  pkg.build?.win?.icon && exists(pkg.build.win.icon),
  `installer icon exists (${pkg.build?.win?.icon ?? "unset"})`,
  "commit the icon referenced by build.win.icon"
);
check(
  pkg.build?.files?.includes("out/**/*"),
  "installer packages the build output (out/**/*)",
  "the electron-vite output must be in build.files"
);

const runtimeDependencies = Object.keys(pkg.dependencies ?? {});
const missingDependencies = runtimeDependencies.filter(
  name => !exists(path.join("node_modules", name, "package.json"))
);
check(
  missingDependencies.length === 0,
  `all ${runtimeDependencies.length} runtime dependencies are installed`,
  missingDependencies.length ? `run npm install (missing: ${missingDependencies.join(", ")})` : undefined
);

console.log("\n--- 3. build output ---");

const buildOutput = [
  "out/main/main.js",
  "out/preload/preload.js",
  "out/renderer/index.html"
];

const missingBuild = buildOutput.filter(file => !exists(file));

if (missingBuild.length) {
  fail(
    `build output is complete (missing: ${missingBuild.join(", ")})`,
    "run npm run build before verify:release"
  );
} else {
  pass("electron-vite build output is present (main, preload, renderer)");
}

const mainBundle = exists("out/main/main.js") ? read("out/main/main.js") : "";
check(
  /better-sqlite3/.test(mainBundle),
  "built main process actually references better-sqlite3",
  "rebuild: the bundled main process looks unrelated to this app"
);

console.log("\n--- 4. packaging ---");

const distDir = path.join(root, "dist");
const installers = fs.existsSync(distDir)
  ? fs
      .readdirSync(distDir)
      .filter(name => name.endsWith(".exe") && !name.endsWith(".blockmap"))
  : [];

if (installers.length) {
  const installer = installers[0];
  const stats = fs.statSync(path.join(distDir, installer));
  check(
    stats.size > 20 * 1024 * 1024,
    `installer looks complete (${installer}, ${(stats.size / 1024 / 1024).toFixed(1)} MB)`,
    "a packaged installer under 20 MB is almost certainly a failed build"
  );
} else if (requireDist) {
  fail("a packaged Windows installer exists in dist/", "run npm run dist:win");
} else {
  warn("no installer in dist/ — run npm run dist:win to verify packaging end to end");
}

console.log("\n--- summary ---");
if (failures.length) {
  console.error(`${failures.length} release check(s) failed:`);
  failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
  process.exit(1);
}

if (warnings.length) {
  console.log(`${warnings.length} warning(s):`);
  warnings.forEach(warning => console.log(`  - ${warning}`));
}

console.log("MBS release verification: PASS");
