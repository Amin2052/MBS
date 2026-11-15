/**
 * Graphite Atelier — happy-path write test.
 *
 * The interaction pass proved empty submits are rejected. This script proves the
 * opposite case works: a correctly filled dialog saves, the record appears in
 * the list, and it is still there after a full reload (i.e. it really reached
 * SQLite through IPC, not just React state).
 *
 * It also asserts the F27 regression directly: an empty submit must create
 * nothing.
 *
 * Everything runs against a disposable --user-data-dir, so no real workspace is
 * touched.
 *
 * Usage: node scripts/qa/happy-path.mjs
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

const DIALOG = "[class*='modal-overlay']";
const outDir = join(process.cwd(), "qa-screenshots", "happy-path");
const userDataDir = mkdtempSync(join(tmpdir(), "mbs-qa-happy-"));

const app = await electron.launch({
  args: [".", `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  cwd: process.cwd()
});

const errors = [];
const results = [];
let page = null;

function track() {
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  page.on("console", m => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("dialog", async d => {
    errors.push(`native dialog: ${d.message()}`);
    await d.accept().catch(() => {});
  });
}

async function waitForWindow() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const found = app.windows().find(p => {
      const u = p.url();
      return u.includes("index.html") || u.startsWith("file://") || u.includes("localhost:5173");
    });
    if (found) return found;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error("No renderer window appeared");
}

async function authenticate() {
  await page.evaluate(async data => {
    const api = window.mooral;
    const lic = await api.license.getStatus().catch(() => null);
    if (!lic || !lic.valid) {
      await api.license.activateTrial({
        ownerFullName: data.fullName,
        companyName: data.company,
        email: data.email,
        phone: data.phone
      }).catch(() => null);
    }
    if ((await api.auth.checkSetupRequired().catch(() => false)) === true) {
      await api.auth.setupOwner({ username: data.username, password: data.password }).catch(() => null);
    }
    if (await api.auth.getCurrentUser().catch(() => null)) {
      await api.auth.logout().catch(() => {});
    }
    await api.auth.login({
      username: data.username,
      password: data.password,
      rememberMe: true
    }).catch(() => null);
  }, OWNER);
}

async function gotoRoute(path) {
  await page.evaluate(p => {
    window.location.hash = `#${p}`;
  }, path);
  await page.waitForTimeout(1100);
}

async function shoot(name) {
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 15000 }).catch(() => {});
}

async function openDialogByText(regex) {
  return page.evaluate(pattern => {
    const rx = new RegExp(pattern, "i");
    const btn = Array.from(document.querySelectorAll("button"))
      .find(b => {
        const label = (b.innerText || b.getAttribute("aria-label") || "").trim();
        if (!rx.test(label)) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    if (!btn) return false;
    btn.click();
    return true;
  }, regex.source);
}

function bodyText() {
  return page.evaluate(() => document.body.innerText || "");
}

function dialogOpen() {
  return page.evaluate(sel => document.querySelectorAll(sel).length > 0, DIALOG);
}

/** Fills the dialog's inputs in DOM order and saves via the given selector. */
async function fillAndSave(values, saveSelector) {
  await page.evaluate(vals => {
    const scope = document.querySelector("[class*='modal-overlay']");
    if (!scope) return;
    const inputs = Array.from(scope.querySelectorAll("input, textarea, select"));
    vals.forEach((value, i) => {
      const el = inputs[i];
      if (!el) return;
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, values);

  await page.click(saveSelector);
  await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------- flows

async function customerFlow() {
  const record = { flow: "customer create", steps: [] };
  const name = "QA Probe Customer";

  await gotoRoute("/customers");
  const before = (await bodyText()).includes(name) ? 1 : 0;
  record.steps.push(`pre-existing:${before}`);

  // 1. Empty submit must not write anything (F27 regression guard).
  await openDialogByText(/add customer/i);
  await page.waitForTimeout(700);
  await page.click(".save-customer");
  await page.waitForTimeout(1200);
  const stillOpen = await dialogOpen();
  record.steps.push(`empty-submit-dialog-open:${stillOpen}`);
  record.steps.push(`empty-submit-message:${(await bodyText()).includes("Enter the customer name")}`);

  // 2. Fill it properly and save.
  await page.evaluate(() => {
    const scope = document.querySelector("[class*='modal-overlay']");
    const inputs = scope ? Array.from(scope.querySelectorAll("input")) : [];
    if (inputs[0]) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(inputs[0], "QA Probe Customer");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.fill(DIALOG + " input:nth-of-type(1)", name).catch(() => {});
  // Fall back to filling by index in case the selector is brittle.
  await page.evaluate(n => {
    const scope = document.querySelector("[class*='modal-overlay']");
    const inputs = scope ? Array.from(scope.querySelectorAll("input")) : [];
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    if (inputs[0]) set(inputs[0], n);
    if (inputs[1]) set(inputs[1], "+8801999000111");
    if (inputs[2]) set(inputs[2], "qa.probe@atelier.test");
    if (inputs[3]) set(inputs[3], "QA Street 1");
  }, name);
  await page.waitForTimeout(300);
  await shoot("customer-form-filled");

  await page.click(".save-customer");
  await page.waitForTimeout(1800);
  record.steps.push(`dialog-closed:${!(await dialogOpen())}`);
  record.steps.push(`visible-after-save:${(await bodyText()).includes(name)}`);

  // 3. Survives a reload (proves it reached SQLite, not just React state).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  await gotoRoute("/customers");
  record.steps.push(`visible-after-reload:${(await bodyText()).includes(name)}`);
  await shoot("customer-created");

  results.push(record);
  console.log(`customer create: ${record.steps.join(" | ")}`);
}

async function productFlow() {
  const record = { flow: "product create", steps: [] };
  const name = "QA Probe Product";

  await gotoRoute("/products");
  await openDialogByText(/add product/i);
  await page.waitForTimeout(700);
  if (!(await dialogOpen())) {
    record.steps.push("dialog-did-not-open");
    results.push(record);
    console.log(`product create: ${record.steps.join(" | ")}`);
    return;
  }

  await page.evaluate(n => {
    const scope = document.querySelector("[class*='modal-overlay']");
    const inputs = scope ? Array.from(scope.querySelectorAll("input")) : [];
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    if (inputs[0]) set(inputs[0], n);
    if (inputs[1]) set(inputs[1], "QA Category");
    if (inputs[2]) set(inputs[2], "QA-SKU-001");
    if (inputs[3]) set(inputs[3], "1250");
    if (inputs[4]) set(inputs[4], "7");
  }, name);
  await page.waitForTimeout(300);

  await page.click(".save-product");
  await page.waitForTimeout(1800);
  record.steps.push(`dialog-closed:${!(await dialogOpen())}`);
  record.steps.push(`visible-after-save:${(await bodyText()).includes(name)}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  await gotoRoute("/products");
  record.steps.push(`visible-after-reload:${(await bodyText()).includes(name)}`);
  await shoot("product-created");

  results.push(record);
  console.log(`product create: ${record.steps.join(" | ")}`);
}

async function themePersistenceFlow() {
  const record = { flow: "theme persistence", steps: [] };
  await gotoRoute("/");
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".topbar-icon-btn"))
      .find(b => /theme|appearance/i.test(b.getAttribute("aria-label") || ""));
    if (btn) btn.click();
  });
  await page.waitForTimeout(700);
  const afterToggle = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  record.steps.push(`toggled-to:${afterToggle}`);
  record.steps.push(`after-reload:${afterReload}`);
  record.steps.push(`persisted:${afterToggle === afterReload}`);
  results.push(record);
  console.log(`theme persistence: ${record.steps.join(" | ")}`);
}

try {
  page = await waitForWindow();
  track();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
  await authenticate();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.waitForSelector(".sidebar", { timeout: 12000 });

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setContentSize(1440, 900);
      win.center();
    }
  });
  await page.evaluate(() => {
    localStorage.setItem("mooral.language", "en");
    localStorage.setItem("mooral.theme", "dark");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.waitForSelector(".sidebar", { timeout: 12000 });

  console.log("\nFlows:");
  await customerFlow();
  await productFlow();
  await themePersistenceFlow();

  const failures = results.flatMap(r =>
    r.steps
      .filter(s => /false|null/.test(s) || /did-not-open/.test(s))
      .map(s => `${r.flow}: ${s}`)
  );

  console.log(`\nRenderer errors: ${errors.length}`);
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(`  - ${e}`);
  console.log(`Failed assertions: ${failures.length}`);
  for (const f of failures) console.log(`  ! ${f}`);
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error("HAPPY PATH FAILED:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await app.close();
}
