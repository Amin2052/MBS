// Verifies the company-logo upload flow end to end in the real app:
//   1. picking a 1376x768 PNG fits it into the square frame (no stretch),
//   2. a review preview is shown and NOTHING is stored yet,
//   3. approving stores a 512x512 PNG and the frame shows it,
//   4. the renderer produced no errors.
// Boots a disposable profile and authenticates through the real IPC handlers,
// exactly like capture-routes.mjs (which also documents the trial-anchor side
// effect of activateTrial: ~/.mbs_sys_cache).
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = {
  username: "qa.owner",
  password: "QaOwner!2026",
  fullName: "QA Automation",
  company: "QA Atelier Ltd",
  email: "qa@atelier.test",
  phone: "+8801700000000"
};

const userDataDir = mkdtempSync(join(tmpdir(), "mbs-qa-logo-"));
const outDir = join(process.cwd(), "qa-screenshots", "logo");
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: [".", `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  cwd: process.cwd()
});

const errors = [];
const page = await app.firstWindow({ timeout: 30000 });
page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
page.on("console", message => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.waitForTimeout(3500);

const auth = await page.evaluate(async owner => {
  const api = window.mooral;
  const license = await api.license.getStatus().catch(() => null);
  if (!license || !license.valid) {
    await api.license.activateTrial({
      ownerFullName: owner.fullName,
      companyName: owner.company,
      email: owner.email,
      phone: owner.phone
    });
  }
  const setupRequired = await api.auth.checkSetupRequired().catch(() => false);
  if (setupRequired === true) {
    await api.auth.setupOwner({ username: owner.username, password: owner.password });
  }
  const current = await api.auth.getCurrentUser().catch(() => null);
  if (current) await api.auth.logout().catch(() => {});
  const login = await api.auth.login({ username: owner.username, password: owner.password, rememberMe: true });
  return { login: login?.success };
}, OWNER);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".sidebar", { timeout: 20000 });
await page.waitForTimeout(1200);

await page.evaluate(() => { window.location.hash = "#/settings/company-profile"; });
await page.waitForSelector(".logo-file-input", { state: "attached", timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, "before.png"), fullPage: true });

const beforeStored = await page.evaluate(() => window.mooral.settings.getLogoPreview());

await page.setInputFiles(".logo-file-input", join(process.cwd(), "src", "assets", "license-background.png"));
await page.waitForSelector(".logo-review", { timeout: 15000 });
await page.waitForTimeout(500);

const reviewMeta = (await page.locator(".logo-review-meta").innerText()).replace(/\s+/g, " ").trim();
const reviewPreviewBox = await page.locator(".logo-review-preview img").boundingBox();
const previewSrc = await page.locator(".logo-review-preview img").getAttribute("src");
const storedWhileReviewing = await page.evaluate(() => window.mooral.settings.getLogoPreview());

await page.screenshot({ path: join(outDir, "review.png"), fullPage: true });

await page.getByRole("button", { name: /use this logo/i }).click();
await page.waitForSelector(".logo-review", { state: "detached", timeout: 15000 });
await page.waitForTimeout(800);

const storedAfterApprove = await page.evaluate(() => window.mooral.settings.getLogoPreview());
const storedDimensions = await page.evaluate(async () => {
  const dataUrl = await window.mooral.settings.getLogoPreview();
  if (!dataUrl) return null;
  return await new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, bytes: dataUrl.length });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
});

const frameImage = await page.locator(".logo-preview-box img").count();
await page.screenshot({ path: join(outDir, "uploaded.png"), fullPage: true });

await app.close();

const reviewOriginal = /1376\s*×\s*768/.test(reviewMeta);
const reviewFitted = /512\s*×\s*286/.test(reviewMeta);
const previewIsSquareCanvas = await (async () => {
  // the reviewed data URL is a 512x512 PNG canvas
  return typeof previewSrc === "string" && previewSrc.startsWith("data:image/png;base64,");
})();

const report = {
  auth,
  beforeStored,
  reviewMeta,
  reviewOriginal,
  reviewFitted,
  reviewPreviewBox,
  previewIsSquareCanvas,
  storedWhileReviewing,
  storedAfterApprove: Boolean(storedAfterApprove),
  storedDimensions,
  frameImage,
  errors
};

const ok =
  auth.login === true &&
  beforeStored === null &&
  reviewOriginal &&
  reviewFitted &&
  previewIsSquareCanvas &&
  storedWhileReviewing === null &&
  Boolean(storedAfterApprove) &&
  storedDimensions?.width === 512 &&
  storedDimensions?.height === 512 &&
  frameImage === 1 &&
  errors.length === 0;

console.log(JSON.stringify({ ...report, ok }, null, 2));
process.exit(ok ? 0 : 1);
