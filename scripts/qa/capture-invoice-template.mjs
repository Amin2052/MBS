// Visual + content check for the invoice template.
//
// Drives the real app, opens a real invoice through its Print action, and
// screenshots the actual print-preview BrowserWindow (the same HTML that is
// printed and exported to PDF). Also asserts the template's defining traits:
// serif type, masthead, metadata band, item table, totals and footer, with no
// horizontal overflow.
//
// Requires the QA renderer server on 127.0.0.1:5173.
import { _electron as electron } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const OWNER = {
  username: "qa.owner",
  password: "QaOwner!2026",
  fullName: "QA Automation",
  company: "QA Atelier Ltd",
  email: "qa@atelier.test",
  phone: "+8801700000000"
};

const outDir = join(process.cwd(), "qa-screenshots", "invoice");
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: [".", `--user-data-dir=${mkdtempSync(join(tmpdir(), "mbs-qa-invoice-"))}`, "--no-sandbox"],
  cwd: process.cwd()
});

const errors = [];
function track(p) {
  p.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  p.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
}

async function mainWindow() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const found = app.windows().find(p => {
      const url = p.url();
      return url.includes("index.html") || url.startsWith("file://") || url.includes("localhost:5173");
    });
    if (found) return found;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error("No renderer window appeared");
}

const page = await mainWindow();
track(page);

const auth = await page.evaluate(async data => {
  const api = window.mooral;
  const lic = await api.license.getStatus().catch(() => null);
  if (!lic || !lic.valid) {
    await api.license.activateTrial({
      ownerFullName: data.fullName, companyName: data.company, email: data.email, phone: data.phone
    }).catch(() => null);
  }
  if (await api.auth.checkSetupRequired().catch(() => true)) {
    await api.auth.setupOwner({ username: data.username, password: data.password }).catch(() => null);
  }
  if (await api.auth.getCurrentUser().catch(() => null)) await api.auth.logout().catch(() => {});
  const login = await api.auth.login({ username: data.username, password: data.password, rememberMe: true }).catch(e => ({ success: false, error: e.message }));
  await api.auth.restoreSession().catch(() => null);
  return login?.success ?? false;
}, OWNER);

if (!auth) throw new Error("QA authentication failed (trial may already be spent on this machine)");

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".sidebar", { timeout: 15000 });
await page.evaluate(() => { window.location.hash = "#/invoices"; });
await page.waitForTimeout(1500);

const printButton = page.locator('button[title="Print"]').first();
await printButton.waitFor({ timeout: 15000 });
await printButton.click();

// The invoice is previewed in the renderer's own modal
// (PrintPreviewModal), which hosts the exact HTML that print/PDF consume
// inside an iframe.
await page.waitForSelector(".print-preview-overlay", { timeout: 20000 });
await page.waitForTimeout(900);

const iframeElement = page.locator(".print-preview-panel iframe").first();
const frame = page.frames().find(f => f !== page.mainFrame() && f.url() !== "about:blank")
  || page.frames().find(f => f !== page.mainFrame());
if (!frame) throw new Error("Invoice preview iframe not found");
await frame.waitForSelector(".items", { timeout: 12000 });

const checks = await frame.evaluate(() => {
  const $ = sel => document.querySelector(sel);
  const body = document.body;
  const font = getComputedStyle(body).fontFamily || "";
  return {
    hasMasthead: Boolean($(".masthead")),
    hasCrest: Boolean($(".crest")) && ($(".crest")?.textContent || "").trim().length === 1,
    hasMetadataCells: document.querySelectorAll(".metadata .meta-cell").length,
    itemRows: document.querySelectorAll(".items tbody tr").length,
    itemColumns: document.querySelectorAll(".items thead th").length,
    hasTotals: Boolean($(".total-final")) && document.querySelectorAll(".totals .total-row").length >= 3,
    hasFooter: Boolean($(".footer")),
    hasQr: Boolean($("img.qr-img")),
    serif: /Times New Roman/i.test(font),
    title: document.title,
    invoiceNo: $(".invoice-number")?.textContent?.trim() || "",
    overflowX: body.scrollWidth > body.clientWidth + 1
  };
});

// Capture the sheet itself (full A4 height) from the iframe's real HTML, and
// the surrounding preview modal for context.
const sheetHtml = await frame.content();
const [sheetPage] = await Promise.all([
  app.waitForEvent("window"),
  app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({ show: true, width: 900, height: 1300 });
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    return win.id;
  }, sheetHtml)
]);
track(sheetPage);
await sheetPage.waitForLoadState("load");
await sheetPage.waitForTimeout(400);
await sheetPage.screenshot({ path: join(outDir, "invoice-preview.png"), fullPage: true });
await sheetPage.close();
await page.locator(".print-preview-overlay").screenshot({ path: join(outDir, "invoice-modal.png") });

console.log(JSON.stringify({ checks, errors }, null, 2));

const ok =
  checks.hasMasthead && checks.hasCrest && checks.hasMetadataCells === 4 &&
  checks.itemRows > 0 && checks.itemColumns === 4 && checks.hasTotals &&
  checks.hasFooter && checks.hasQr && checks.serif && !checks.overflowX &&
  errors.length === 0;

await app.close();
process.exit(ok ? 0 : 1);
