/**
 * Graphite Atelier — interaction pass.
 *
 * Renders are covered by capture-routes.mjs; this script clicks. For each
 * data-entry screen it opens the create dialog, submits it empty to see whether
 * validation actually blocks the write, closes it again, and records console
 * errors and unhandled rejections along the way. It also exercises the shell
 * controls (notification popover, profile menu, theme toggle, Ctrl+K search).
 *
 * It writes only to a disposable --user-data-dir database, so a rejected or
 * accepted submit cannot touch a real workspace.
 *
 * Output: qa-screenshots/interactions/<name>.png + a printed verdict table.
 *
 * Usage: node scripts/qa/interact-routes.mjs
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

// Pages use several overlay class names (modal-overlay, employee-modal-overlay,
// certificate-modal-overlay, ...), so match on the suffix rather than a list.
const MODAL_SELECTOR =
  "[class*='modal-overlay'], .modal, [role='dialog'], .mbs-license-modal-backdrop";

const PAGE_FLOWS = [
  { path: "/customers", name: "customers", addText: /add customer/i },
  { path: "/products", name: "products", addText: /add product/i },
  { path: "/orders", name: "orders", addText: /create order|add order|new order/i },
  { path: "/invoices", name: "invoices", addText: /create invoice|new invoice|add invoice/i },
  { path: "/employees", name: "employees", addText: /add employee|new employee/i },
  { path: "/certificates", name: "certificates", addText: /add certificate|new certificate/i }
];

const userDataDir = mkdtempSync(join(tmpdir(), "mbs-qa-interact-"));
const outDir = join(process.cwd(), "qa-screenshots", "interactions");

const app = await electron.launch({
  args: [".", `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  cwd: process.cwd()
});

const errors = [];
const results = [];
let page = null;

const nativeAlerts = [];

function trackErrors() {
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  page.on("console", m => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  // Several pages validate with window.alert(); Playwright dismisses those by
  // default, which would make a working validation look like a silent no-op.
  page.on("dialog", async d => {
    nativeAlerts.push(d.message());
    await d.dismiss().catch(() => {});
  });
}

async function waitForWindow(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
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

async function ensureAuthenticated() {
  const state = await page.evaluate(async data => {
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
    const setupRequired = await api.auth.checkSetupRequired().catch(() => false);
    if (setupRequired === true) {
      await api.auth.setupOwner({ username: data.username, password: data.password }).catch(() => null);
    }
    const current = await api.auth.getCurrentUser().catch(() => null);
    if (current) await api.auth.logout().catch(() => {});
    await api.auth.login({
      username: data.username,
      password: data.password,
      rememberMe: true
    }).catch(() => null);
  }, OWNER);
  return state;
}

async function shellReady() {
  return page
    .waitForSelector(".sidebar", { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
}

async function shoot(name) {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 15000 });
    return file;
  } catch {
    return null;
  }
}

async function gotoRoute(path) {
  await page.evaluate(p => {
    window.location.hash = `#${p}`;
  }, path);
  await page.waitForTimeout(1000);
}

/** Clicks the first visible button whose text matches, returning whether it hit. */
async function clickByText(regex) {
  return page.evaluate(pattern => {
    const rx = new RegExp(pattern, "i");
    const buttons = Array.from(document.querySelectorAll("button, a[role='button']"));
    const target = buttons.find(b => {
      const label = (b.innerText || b.getAttribute("aria-label") || "").trim();
      if (!label || !rx.test(label)) return false;
      const rect = b.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!target) return false;
    target.click();
    return true;
  }, regex.source);
}

function modalCount() {
  return page.evaluate(sel => document.querySelectorAll(sel).length, MODAL_SELECTOR);
}

async function runPageFlow(flow) {
  const record = { page: flow.name, opened: false, escClosed: null, validationBlocked: null, note: "" };
  await gotoRoute(flow.path);

  const clicked = await clickByText(flow.addText);
  if (!clicked) {
    record.note = "no matching add button found";
    results.push(record);
    console.log(`  ${flow.name}: SKIP — ${record.note}`);
    return;
  }

  await page.waitForTimeout(800);
  const open = (await modalCount()) > 0;
  record.opened = open;
  if (!open) {
    record.note = "click did not open a dialog";
    results.push(record);
    console.log(`  ${flow.name}: FAIL — ${record.note}`);
    return;
  }

  await shoot(`${flow.name}-dialog`);

  // Submit with the form untouched: a correct form must refuse to write.
  const submitted = await page.evaluate(() => {
    const scope = document.querySelector("[class*='modal-overlay'], .modal, [role='dialog']");
    if (!scope) return false;
    const buttons = Array.from(scope.querySelectorAll("button"));
    const rx = /save|add|create|submit|confirm|continue|next/i;
    // Dialogs like New Order contain an "add line" button above the footer, so
    // the submit control is the LAST match rather than the first.
    const matches = buttons.filter(b => rx.test(b.innerText || "") && !b.disabled);
    const target = matches[matches.length - 1];
    if (!target) return false;
    target.click();
    return true;
  });

  if (!submitted) {
    record.note = "no submit button inside dialog";
  } else {
    const alertsBefore = nativeAlerts.length;
    await page.waitForTimeout(1200);
    const raisedAlert =
      nativeAlerts.length > alertsBefore ? nativeAlerts[nativeAlerts.length - 1] : null;
    // Successful-but-invalid submits usually close the dialog. If it is still
    // open, look for any visible validation message.
    const stillOpen = (await modalCount()) > 0;
    const message = stillOpen
      ? await page.evaluate(() => {
          const scope = document.querySelector("[class*='modal-overlay'], .modal, [role='dialog']");
          if (!scope) return "";
          const rx = /required|invalid|please|cannot|must|enter|select|too short|already exists|missing/i;
          const nodes = Array.from(scope.querySelectorAll("p, span, div, small, label"));
          const hit = nodes.find(n => {
            const text = (n.textContent || "").trim();
            return text.length > 2 && text.length < 160 && rx.test(text) &&
              n.children.length === 0 &&
              n.getBoundingClientRect().height > 0;
          });
          return hit ? hit.textContent.trim() : "";
        })
      : "";

    if (stillOpen) {
      record.validationBlocked = true;
      record.note = raisedAlert
        ? `validation blocked (alert): "${raisedAlert}"`
        : message
          ? `validation kept dialog open: "${message}"`
          : "dialog stayed open but NO MESSAGE was shown";
      await shoot(`${flow.name}-validation`);
    } else {
      // The dialog closed without any input: either it saved a blank record or
      // it silently discarded. Worth flagging either way.
      record.validationBlocked = false;
      record.note = "EMPTY SUBMIT CLOSED THE DIALOG";
      await shoot(`${flow.name}-empty-submit`);
    }
  }

  // Recover: reopen if closed, then dismiss with Escape.
  if ((await modalCount()) === 0) {
    await clickByText(flow.addText);
    await page.waitForTimeout(600);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  record.escClosed = (await modalCount()) === 0;

  if (!record.escClosed) {
    // Fall back to the close control so the next flow is not blocked.
    await page.evaluate(() => {
      const scope = document.querySelector("[class*='modal-overlay'], .modal, [role='dialog']");
      const buttons = scope ? Array.from(scope.querySelectorAll("button")) : [];
      const close = buttons.find(b => /close|cancel|×|✕/i.test(b.innerText || "") ||
        /close|cancel/i.test(b.getAttribute("aria-label") || ""));
      if (close) close.click();
      else if (scope) scope.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(500);
  }

  results.push(record);
  console.log(`  ${flow.name}: ${record.note}`);
}

async function runShellFlows() {
  await gotoRoute("/");

  // Notification popover
  const bellOpened = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".topbar-icon-btn"))
      .find(b => /notification|إشعار|বিজ্ঞপ্তি/i.test(b.getAttribute("aria-label") || ""));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(900);
  const popoverVisible = await page
    .waitForSelector(".topbar-notifications", { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (bellOpened && popoverVisible) await shoot("shell-notifications");
  results.push({
    page: "shell",
    opened: popoverVisible,
    escClosed: null,
    validationBlocked: null,
    note: bellOpened ? (popoverVisible ? "notification popover opens" : "bell click did not open popover") : "bell not found"
  });
  console.log(`  shell: ${results.at(-1).note}`);

  // Escape should dismiss the popover.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const popoverGone = await page.evaluate(() => !document.querySelector(".topbar-notifications"));
  results.at(-1).escClosed = popoverGone;
  if (!popoverGone) console.log("  shell: Escape did not close the notification popover");

  // Profile menu (the real class is .profile-btn inside .profile-menu-wrapper)
  const profileOpened = await page.evaluate(() => {
    const btn = document.querySelector(".profile-btn");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(700);
  const profileMenu = await page.evaluate(() =>
    Boolean(document.querySelector(".topbar-popover, .topbar-menu, [role='menu']"))
  );
  if (profileOpened && profileMenu) await shoot("shell-profile-menu");
  results.push({
    page: "profile-menu",
    opened: profileMenu,
    escClosed: null,
    validationBlocked: null,
    note: profileOpened ? (profileMenu ? "profile menu opens" : "profile click did not open menu") : "profile button not found"
  });
  console.log(`  profile-menu: ${results.at(-1).note}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Ctrl+K focuses search
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  const searchFocused = await page.evaluate(() => {
    const el = document.activeElement;
    return Boolean(el && el.closest && el.closest(".topbar-search")) ||
      Boolean(el && el.getAttribute && /search/i.test(el.getAttribute("placeholder") || ""));
  });
  results.push({
    page: "ctrl-k",
    opened: searchFocused,
    escClosed: null,
    validationBlocked: null,
    note: searchFocused ? "Ctrl+K focuses search" : "Ctrl+K did not focus search"
  });
  console.log(`  ctrl-k: ${results.at(-1).note}`);

  // Theme toggle flips the attribute
  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const themeLabel = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".topbar-icon-btn"));
    const btn = btns.find(b => /theme|appearance|السمة|থিম/i.test(b.getAttribute("aria-label") || ""));
    if (!btn) return null;
    btn.click();
    return btn.getAttribute("aria-label");
  });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  results.push({
    page: "theme-toggle",
    opened: before !== after,
    escClosed: null,
    validationBlocked: null,
    note: !themeLabel
      ? "theme button not found"
      : before !== after
        ? `theme toggles ${before} -> ${after}`
        : `theme did not change (label="${themeLabel}")`
  });
  console.log(`  theme-toggle: ${results.at(-1).note}`);
}

try {
  page = await waitForWindow();
  trackErrors();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);

  await ensureAuthenticated();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  if (!(await shellReady())) throw new Error("App shell did not appear after authentication");

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setContentSize(1440, 900);
      win.center();
    }
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    localStorage.setItem("mooral.language", "en");
    localStorage.setItem("mooral.theme", "dark");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await shellReady();

  console.log("\nPage flows:");
  for (const flow of PAGE_FLOWS) {
    try {
      await runPageFlow(flow);
    } catch (error) {
      results.push({ page: flow.name, note: `EXCEPTION: ${error.message}` });
      console.log(`  ${flow.name}: EXCEPTION ${error.message}`);
    }
  }

  console.log("\nShell flows:");
  await runShellFlows();

  console.log("\n--- summary ---");
  for (const r of results) {
    console.log(
      `${String(r.page).padEnd(22)} open=${String(r.opened).padEnd(5)} esc=${String(r.escClosed).padEnd(5)} ${r.note}`
    );
  }

  const failures = results.filter(r =>
    r.opened === false ||
    r.validationBlocked === false ||
    r.escClosed === false ||
    /EXCEPTION|SKIP|did not|not found|EMPTY SUBMIT/i.test(r.note)
  );
  console.log(`\nNative alerts raised: ${nativeAlerts.length}`);
  for (const a of [...new Set(nativeAlerts)].slice(0, 10)) console.log(`  - ${a}`);
  console.log(`Renderer errors: ${errors.length}`);
  for (const e of [...new Set(errors)].slice(0, 12)) console.log(`  - ${e}`);
  console.log(`Issues needing attention: ${failures.length}`);
} catch (error) {
  console.error("INTERACTION PASS FAILED:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await app.close();
}
