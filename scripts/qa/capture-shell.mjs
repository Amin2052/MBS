/**
 * Graphite Atelier — shell capture matrix.
 *
 * Boots the real application in a disposable profile and captures the first
 * reachable screen at each of the required desktop window sizes, in both
 * palettes, and in English / Bangla / Arabic (RTL). This is the part of the
 * visual walk that can be done without a licence or account: it exercises the
 * real stylesheets, the real i18n bundles and the real font fallbacks.
 *
 * Output: qa-screenshots/<width>x<height>/<lang>/<theme>/shell.png
 *
 * Usage: node scripts/qa/capture-shell.mjs
 */
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALL_SIZES = [
  { w: 1920, h: 1080 },
  { w: 1600, h: 900 },
  { w: 1366, h: 768 },
  { w: 1280, h: 720 }
];

// Optional filter, e.g. --sizes=1366x768,1280x720 — smaller batches are more
// reliable because each language/theme combination reloads the window.
const sizeArg = process.argv.find(a => a.startsWith("--sizes="));
const wanted = sizeArg ? sizeArg.slice("--sizes=".length).split(",") : null;
const SIZES = wanted
  ? ALL_SIZES.filter(s => wanted.includes(`${s.w}x${s.h}`))
  : ALL_SIZES;

const LANGS = ["en", "bn", "ar"];
const THEMES = ["dark", "light"];

const userDataDir = mkdtempSync(join(tmpdir(), "mbs-qa-capture-"));
const outRoot = join(process.cwd(), "qa-screenshots");

const app = await electron.launch({
  args: [".", `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  cwd: process.cwd()
});

const errors = [];

try {
  let page = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    page = app.windows().find(p => {
      const url = p.url();
      return url.includes("index.html") || url.startsWith("file://") || url.includes("localhost:5173");
    });
    if (page) break;
    await new Promise(r => setTimeout(r, 400));
  }
  if (!page) throw new Error("No renderer window appeared");

  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);

  let captured = 0;

  for (const size of SIZES) {
    await app.evaluate(
      ({ BrowserWindow }, dims) => {
        const win = BrowserWindow.getAllWindows().find(w => {
          const u = w.webContents.getURL();
          return u.includes("index.html") || u.startsWith("file://") || u.includes("localhost:5173");
        });
        if (win) {
          win.setContentSize(dims.w, dims.h);
          win.center();
        }
      },
      size
    );

    // Give Chromium a frame or two to relayout at the new size.
    await page.waitForTimeout(700);

    for (const lang of LANGS) {
      for (const theme of THEMES) {
        await page.evaluate(
          ([l, t]) => {
            localStorage.setItem("mooral.language", l);
            localStorage.setItem("mooral.theme", t);
          },
          [lang, theme]
        );

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2200);

        const dir = join(outRoot, `${size.w}x${size.h}`, lang, theme);
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: join(dir, "shell.png"), timeout: 20000 });
        captured++;

        const htmlDir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
        const htmlTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
        console.log(
          `${size.w}x${size.h} ${lang} ${theme} -> dir=${htmlDir} data-theme=${htmlTheme}`
        );
      }
    }
  }

  console.log(`\nCaptured ${captured} screenshots under ${outRoot}`);
  console.log(`Renderer errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  - ${e}`);
} catch (error) {
  console.error("CAPTURE FAILED:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await app.close();
}
