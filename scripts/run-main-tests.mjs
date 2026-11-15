#!/usr/bin/env node
/**
 * Runs the "main process" regression suite: tests/main/entry-*.ts.
 *
 * These exercise real repository/business-logic code (order/invoice
 * generation, license verification, etc.) against a real temp SQLite
 * database via better-sqlite3's Electron-ABI native binding, which
 * Playwright's own bundled Node cannot load (see package.json's
 * postinstall: electron-rebuild targets Electron's Node ABI, not the
 * system one). So instead of Playwright, each entry file is bundled
 * with esbuild and executed inside a real (offscreen) Electron app
 * instance via `electron <runner> --no-sandbox`.
 *
 * QA FIX (Windows support): this script previously shelled out to `npx`
 * (which `spawnSync` cannot resolve on Windows without a shell) and fell
 * back to `xvfb-run` whenever DISPLAY was unset — so on the product's own
 * target platform (Windows) the suite could not run at all. It now invokes
 * esbuild and Electron through their resolved module paths, which is
 * platform-independent, and only reaches for xvfb on Linux.
 *
 * Usage: node scripts/run-main-tests.mjs
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entriesDir = path.join(root, "tests", "main");
const bundleDir = path.join(entriesDir, ".bundle");

fs.mkdirSync(bundleDir, { recursive: true });

/* Resolve tool paths without relying on PATH or npx. */
const esbuildBin = path.join(root, "node_modules", "esbuild", "bin", "esbuild");
const electronBin = require("electron"); // module export is the binary path

const isWindows = process.platform === "win32";

/*
 * `--only=<substring>` runs a subset (e.g. --only=ipc-security) so a single
 * entry can be reproduced without waiting for the whole suite.
 * `--timeout=<ms>` bounds each entry. Without a bound, one entry that blocks
 * on a network call hangs the entire suite with no output and no exit code --
 * which is exactly what happened on this machine while auditing. A timeout
 * now reports TIMEOUT and fails the run instead of stalling it.
 */
const onlyArg = process.argv.find(arg => arg.startsWith("--only="));
const onlyFilter = onlyArg ? onlyArg.slice("--only=".length) : "";

const timeoutArg = process.argv.find(arg => arg.startsWith("--timeout="));
const entryTimeoutMs = timeoutArg
  ? Number(timeoutArg.slice("--timeout=".length)) || 180000
  : 180000;

const entries = fs
  .readdirSync(entriesDir)
  .filter(f => f.startsWith("entry-") && f.endsWith(".ts"))
  .filter(f => !onlyFilter || f.includes(onlyFilter))
  .sort();

if (entries.length === 0) {
  console.log(
    onlyFilter
      ? `No tests/main/entry-*.ts file matches --only=${onlyFilter}.`
      : "No tests/main/entry-*.ts files found -- nothing to run."
  );
  process.exit(0);
}

const results = [];

for (const entry of entries) {
  const startedAt = Date.now();
  const record = { entry, status: "pass", ms: 0 };
  const entryPath = path.join(entriesDir, entry);
  const bundlePath = path.join(bundleDir, entry.replace(/\.ts$/, ".bundle.cjs"));
  const runnerPath = path.join(bundleDir, entry.replace(/\.ts$/, ".run.js"));

  console.log(`\n--- Building ${entry} ---`);
  execFileSync(
    process.execPath,
    [
      esbuildBin,
      entryPath,
      "--bundle",
      "--platform=node",
      "--external:electron",
      "--external:better-sqlite3",
      `--outfile=${bundlePath}`
    ],
    { cwd: root, stdio: "inherit" }
  );

  fs.writeFileSync(
    runnerPath,
    `const { app } = require("electron");
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  try {
    require(${JSON.stringify(bundlePath)});
  } catch (e) {
    console.error("TEST ERROR", e);
    app.exit(1);
  }
});
`
  );

  console.log(`--- Running ${entry} ---`);
  try {
    // Windows/macOS always have a window server. On Linux, fall back to
    // xvfb-run only when no DISPLAY is present (CI / headless).
    const needsXvfb = process.platform === "linux" && !process.env.DISPLAY;
    const command = needsXvfb ? "xvfb-run" : electronBin;
    const args = needsXvfb
      ? ["-a", electronBin, runnerPath, "--no-sandbox"]
      : [runnerPath, "--no-sandbox"];

    execFileSync(command, args, {
      cwd: root,
      stdio: "inherit",
      timeout: entryTimeoutMs,
      killSignal: "SIGKILL"
    });
  } catch (e) {
    // A killed child surfaces as a signal, not an exit code, so distinguish
    // "took too long" from "asserted a failure" in the report.
    const timedOut = e && (e.signal === "SIGKILL" || e.code === "ETIMEDOUT");
    record.status = timedOut ? "timeout" : "fail";
    console.error(
      timedOut
        ? `--- ${entry} TIMED OUT after ${entryTimeoutMs} ms ---`
        : `--- ${entry} FAILED ---`
    );
    if (isWindows && e && e.message) console.error(e.message);
  }

  record.ms = Date.now() - startedAt;
  results.push(record);
}

/* Summary table: the last thing on screen is what a release check reads. */
const pad = (value, width) => String(value).padEnd(width, " ");
console.log("\n=== main-process test summary ===");
for (const r of results) {
  console.log(
    `${pad(r.status.toUpperCase(), 8)}${pad(r.entry, 42)}${(r.ms / 1000).toFixed(1)}s`
  );
}

const failed = results.filter(r => r.status !== "pass");
console.log(
  `\n${results.length - failed.length}/${results.length} entries passed` +
    (failed.length ? `, ${failed.length} failed` : "")
);

process.exit(failed.length ? 1 : 0);
