/**
 * Graphite Atelier — overlay pass.
 *
 * capture-routes.mjs renders pages; interact-routes.mjs clicks through the
 * create/validation dialogs. Neither shows the two global surfaces a user
 * meets dozens of times a day: the toast stack and the destructive-confirm
 * dialog. This script captures both, in a left-to-right shell (en/dark) and a
 * right-to-left one (ar/light), because that is where direction bugs hide --
 * a toast message's full stop flipping to the visual left, or the confirm
 * buttons landing on the wrong side, only shows up in a real RTL render.
 *
 * The toasts are raised through the real store (`toast-store.ts`, imported
 * from the dev server) with the four variants and representative copy, so the
 * captured colours and icons are the shipped ones rather than a mock.
 *
 * Requires the QA Vite server (see capture-routes.mjs) to be running, since
 * the renderer is loaded from http://localhost:5173.
 *
 * Output: qa-screenshots/dialogs-toasts/*.png
 *
 * Usage: node scripts/qa/capture-dialogs-toasts.mjs
 */
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

const outDir = join(process.cwd(), "qa-screenshots", "dialogs-toasts");
mkdirSync(outDir, { recursive: true });

const userDataDir = mkdtempSync(join(tmpdir(), "mbs-qa-dialogs-"));
const app = await electron.launch({
  args: [".", `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  cwd: process.cwd()
});

const errors = [];
let page = null;
const deadline = Date.now() + 30000;
while (Date.now() < deadline && !page) {
  page = app.windows().find(p => {
    const u = p.url();
    return u.includes("index.html") || u.startsWith("file://") || u.includes("localhost:5173");
  });
  if (!page) await new Promise(r => setTimeout(r, 400));
}
if (!page) throw new Error("No renderer window appeared");
page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
await page.waitForTimeout(1500);

await page.evaluate(async data => {
  const api = window.mooral;
  const lic = await api.license.getStatus().catch(() => null);
  if (!lic || !lic.valid) {
    await api.license.activateTrial({
      ownerFullName: data.fullName, companyName: data.company,
      email: data.email, phone: data.phone
    }).catch(() => null);
  }
  if ((await api.auth.checkSetupRequired().catch(() => false)) === true) {
    await api.auth.setupOwner({ username: data.username, password: data.password }).catch(() => null);
  }
  if (await api.auth.getCurrentUser().catch(() => null)) {
    await api.auth.logout().catch(() => {});
  }
  await api.auth.login({ username: data.username, password: data.password, rememberMe: true }).catch(() => null);
}, OWNER);

async function apply(lang, theme, width, height) {
  await app.evaluate(({ BrowserWindow }, dims) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { win.setContentSize(dims.w, dims.h); win.center(); }
  }, { w: width, h: height });
  await page.evaluate(([l, t]) => {
    localStorage.setItem("mooral.language", l);
    localStorage.setItem("mooral.theme", t);
  }, [lang, theme]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
}

async function shot(name) {
  try {
    await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 15000 });
    console.log(`shot ${name}`);
  } catch (e) {
    console.log(`shot FAILED ${name}: ${e.message}`);
  }
}

const variants = [
  ["success", "Customer saved successfully."],
  ["error", "Could not save the customer. Please try again."],
  ["warning", "Quantity must be greater than zero."],
  ["info", "Export finished."]
];

// English dark + Arabic light. The toast store is a module singleton, so it is
// imported straight from the dev server, exactly as the app does.
for (const [lang, theme] of [["en", "dark"], ["ar", "light"]]) {
  await apply(lang, theme, 1366, 768);

  await page.evaluate(async list => {
    const mod = await import("/src/components/toast/toast-store.ts");
    list.forEach(([kind, msg]) => mod.toast[kind](msg));
  }, variants);
  await page.waitForTimeout(400);
  await shot(`toasts-4-${lang}-${theme}`);

  await page.evaluate(async () => {
    const mod = await import("/src/components/toast/toast-store.ts");
    mod.toast.dismissAll();
  });
  await page.waitForTimeout(500);

  // Confirm dialog: delete a customer row.
  await page.evaluate(() => { window.location.hash = "#/customers"; });
  await page.waitForTimeout(2500);
  const opened = await page.evaluate(() => {
    const card = document.querySelector(".customer-card");
    const btn = card ? Array.from(card.querySelectorAll(".customer-actions button")).pop() : null;
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(700);
  const dialogText = await page.evaluate(() => {
    const d = document.querySelector("[role='alertdialog'], [role='dialog']");
    return d ? d.innerText.replace(/\s+/g, " ").trim().slice(0, 160) : null;
  });
  console.log(`confirm dialog (${lang}/${theme}): ${opened ? dialogText ?? "NOT SHOWN" : "no delete button"}`);
  await shot(`confirm-${lang}-${theme}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

console.log(`renderer-errors: ${errors.length}`);
errors.slice(0, 5).forEach(e => console.log(`  ${e}`));
await app.close();
