/**
 * Graphite Atelier — Electron render smoke test.
 *
 * Boots the real built application (out/main/main.js) in a throwaway
 * `--user-data-dir` so the developer's actual profile, database and licence
 * files are never touched, then:
 *   - fails on any renderer console error or uncaught page error,
 *   - records the first screen's text so we know which gate rendered
 *     (licence / login / workspace),
 *   - writes a screenshot under qa-screenshots/smoke/.
 *
 * This is a render-integrity check, not a full route walk. It exists because
 * a stylesheet/i18n/shell change can compile and typecheck cleanly while
 * still throwing at first paint (missing translation object, undefined
 * component, etc.), which no static check catches.
 *
 * Usage: node scripts/qa/smoke-electron.mjs
 */
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userDataDir = mkdtempSync(join(tmpdir(), "mbs-qa-smoke-"));
const shotDir = join(process.cwd(), "qa-screenshots", "smoke");
mkdirSync(shotDir, { recursive: true });

const consoleErrors = [];
const pageErrors = [];

console.log(`Launching Electron with disposable profile: ${userDataDir}`);

const app = await electron.launch({
  args: [".", `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  cwd: process.cwd()
});

let exitCode = 0;

try {
  // The app creates more than one BrowserWindow (print/preview helpers). Wait
  // for the window that actually hosts the renderer bundle rather than
  // screenshotting whichever window happened to be created first.
  let page = null;
  const deadline = Date.now() + 25000;

  while (Date.now() < deadline) {
    const windows = app.windows();
    for (const candidate of windows) {
      const url = candidate.url();
      // Packaged builds load out/renderer/index.html (file://); an unpackaged
      // run loads the Vite dev server. Both are the real renderer.
      if (
        url.includes("index.html") ||
        url.startsWith("file://") ||
        url.includes("localhost:5173")
      ) {
        page = candidate;
        break;
      }
    }
    if (page) break;
    await new Promise(r => setTimeout(r, 400));
  }

  if (!page) {
    console.log("Windows seen: " + JSON.stringify(app.windows().map(w => w.url()), null, 2));
    throw new Error("No renderer window appeared within 25s");
  }

  console.log(`Renderer window URL: ${page.url()}`);

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  // First paint + licence/DB initialisation.
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);

  await page.screenshot({ path: join(shotDir, "first-screen.png"), fullPage: false });

  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  console.log(`Title: ${await page.title()}`);
  console.log(`First screen text: ${bodyText.slice(0, 400)}`);

  console.log(`\nRenderer console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 10)) console.log(`  - ${e}`);
  console.log(`Uncaught page errors: ${pageErrors.length}`);
  for (const e of pageErrors.slice(0, 10)) console.log(`  - ${e}`);

  if (pageErrors.length > 0 || consoleErrors.length > 0) {
    exitCode = 1;
    console.log("\nRESULT: renderer reported errors.");
  } else {
    console.log("\nRESULT: rendered cleanly (no console or page errors).");
  }
} catch (error) {
  exitCode = 1;
  console.error("SMOKE LAUNCH FAILED:", error?.message ?? error);
} finally {
  await app.close();
}

process.exit(exitCode);
