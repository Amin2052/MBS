/**
 * Graphite Atelier — authenticated route walk.
 *
 * Boots the real app in a disposable profile, activates the built-in 7-day
 * trial and creates an Owner account *through the real IPC handlers*, then
 * walks every route and captures it. No licence file, no production profile and
 * no real database are touched: everything lives in a temp --user-data-dir.
 *
 * SIDE EFFECT — READ THIS BEFORE RUNNING:
 * trial activation writes an anti-reset "trial anchor" to `os.homedir()/
 * .mbs_sys_cache` on purpose (so deleting app data cannot restart a trial).
 * That anchor is OUTSIDE the temp profile, which means running this script
 * consumes the 7-day trial of the machine it runs on. Use a disposable VM or
 * remove `~/.mbs_sys_cache` afterwards. The script prints the anchor path
 * after activation so it is never a silent side effect.
 *
 * Two passes:
 *   1. every route, 1366x768, English, dark   -> full page coverage
 *   2. key routes, 4 sizes x 3 languages x 2 themes -> responsive/RTL matrix
 *
 * Output: qa-screenshots/routes/<size>/<lang>/<theme>/<route>.png
 *
 * Usage:
 *   node scripts/qa/capture-routes.mjs                  # everything
 *   node scripts/qa/capture-routes.mjs --full-only      # pass 1 only
 *   node scripts/qa/capture-routes.mjs --matrix-only    # pass 2 only
 *   node scripts/qa/capture-routes.mjs --sizes=1366x768
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

const LANGS = ["en", "bn", "ar"];
const THEMES = ["dark", "light"];

// Every route registered in src/router/routes.tsx.
const ALL_ROUTES = [
  { path: "/", name: "dashboard" },
  { path: "/customers", name: "customers" },
  { path: "/products", name: "products" },
  { path: "/product-details", name: "product-details" },
  { path: "/inventory", name: "inventory" },
  { path: "/orders", name: "orders" },
  { path: "/invoices", name: "invoices" },
  { path: "/accounting", name: "accounting" },
  { path: "/reports", name: "reports" },
  { path: "/certificates", name: "certificates" },
  { path: "/employees", name: "employees" },
  { path: "/profile", name: "profile" },
  { path: "/change-password", name: "change-password" },
  { path: "/settings", name: "settings" },
  { path: "/settings/company-profile", name: "settings-company-profile" },
  { path: "/settings/financial-invoice", name: "settings-financial-invoice" },
  { path: "/settings/certificate-settings", name: "settings-certificate-settings" },
  { path: "/settings/localization", name: "settings-localization" },
  { path: "/settings/user-management", name: "settings-user-management" },
  { path: "/settings/finance-accounting", name: "settings-finance-accounting" },
  { path: "/settings/inventory-settings", name: "settings-inventory-settings" },
  { path: "/settings/sales-purchase", name: "settings-sales-purchase" },
  { path: "/settings/hr-payroll", name: "settings-hr-payroll" },
  { path: "/settings/security-settings", name: "settings-security-settings" },
  { path: "/settings/notifications", name: "settings-notifications" },
  { path: "/settings/integrations", name: "settings-integrations" },
  { path: "/settings/document-templates", name: "settings-document-templates" },
  { path: "/settings/database-settings", name: "settings-database-settings" },
  { path: "/settings/license-settings", name: "settings-license-settings" },
  { path: "/settings/about", name: "settings-about" }
];

const KEY_ROUTE_PATHS = [
  "/", "/customers", "/invoices", "/orders", "/reports", "/settings", "/accounting"
];

const args = process.argv.slice(2);
const sizeArg = args.find(a => a.startsWith("--sizes="));
const wanted = sizeArg ? sizeArg.slice("--sizes=".length).split(",") : null;
const SIZES = wanted ? ALL_SIZES.filter(s => wanted.includes(`${s.w}x${s.h}`)) : ALL_SIZES;
const FULL_ONLY = args.includes("--full-only");
const MATRIX_ONLY = args.includes("--matrix-only");
// --routes=name,name captures a subset (used to re-shoot one changed screen
// without re-running the whole 199-image sweep and consuming a fresh trial).
const routeArg = args.find(a => a.startsWith("--routes="));
const WANTED_ROUTES = routeArg
  ? routeArg.slice("--routes=".length).split(",").map(s => s.trim()).filter(Boolean)
  : null;
const ROUTES = WANTED_ROUTES
  ? ALL_ROUTES.filter(r => WANTED_ROUTES.includes(r.name) || WANTED_ROUTES.includes(r.path))
  : ALL_ROUTES;

const OWNER = {
  username: "qa.owner",
  password: "QaOwner!2026",
  fullName: "QA Automation",
  company: "QA Atelier Ltd",
  email: "qa@atelier.test",
  phone: "+8801700000000"
};

const userDataDir = mkdtempSync(join(tmpdir(), "mbs-qa-routes-"));
const outRoot = join(process.cwd(), "qa-screenshots", "routes");

const app = await electron.launch({
  args: [".", `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  cwd: process.cwd()
});

const errors = [];
let page = null;

function track(p) {
  p.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  p.on("console", m => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
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

/** Activate trial + create Owner + log in, all via the real IPC surface. */
async function ensureAuthenticated() {
  const state = await page.evaluate(async OWNER_DATA => {
    const api = window.mooral;
    const out = { steps: [] };

    const lic = await api.license.getStatus().catch(() => null);
    if (!lic || !lic.valid) {
      const t = await api.license.activateTrial({
        ownerFullName: OWNER_DATA.fullName,
        companyName: OWNER_DATA.company,
        email: OWNER_DATA.email,
        phone: OWNER_DATA.phone
      });
      out.steps.push(`activateTrial:${t?.success ?? JSON.stringify(t)}`);
    } else {
      out.steps.push("license:already-valid");
    }

    const setupRequired = await api.auth.checkSetupRequired().catch(e => `error:${e.message}`);
    out.steps.push(`setupRequired:${JSON.stringify(setupRequired)}`);

    if (setupRequired === true) {
      const s = await api.auth.setupOwner({
        username: OWNER_DATA.username,
        password: OWNER_DATA.password
      }).catch(e => ({ success: false, error: e.message }));
      out.steps.push(`setupOwner:${s?.success ?? JSON.stringify(s)}`);
      out.recoveryKey = s?.recoveryKey ?? null;
    }

    // Setup leaves an in-memory session that a fresh renderer load will not
    // restore, so always perform a real "remember me" login. This is also the
    // path a returning user takes, which is what we want to capture.
    const current = await api.auth.getCurrentUser().catch(() => null);
    if (current) await api.auth.logout().catch(() => {});

    const l = await api.auth.login({
      username: OWNER_DATA.username,
      password: OWNER_DATA.password,
      rememberMe: true
    }).catch(e => ({ success: false, error: e.message }));
    out.steps.push(`login:${l?.success ?? JSON.stringify(l)}`);

    const restored = await api.auth.restoreSession().catch(() => null);
    out.steps.push(`restoreSession:${restored ? "ok" : "null"}`);
    return out;
  }, OWNER);

  console.log("auth:", state.steps.join(" | "));

  if (state.steps.some(s => s.startsWith("activateTrial:true"))) {
    console.log(
      "\n  ! This machine's 7-day trial was just consumed: the anti-reset anchor\n" +
        "    lives at ~/.mbs_sys_cache (outside the temp profile by design).\n" +
        "    Remove that directory to leave the machine in a pristine state.\n"
    );
  }

  return state;
}

async function reload() {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  // Wait for the shell to be present; if a gate is still showing, report which.
  const shell = await page
    .waitForSelector(".sidebar", { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  return shell;
}

async function gotoRoute(path) {
  await page.evaluate(p => {
    window.location.hash = `#${p}`;
  }, path);
  await page.waitForTimeout(1100);
}

async function shoot(file) {
  mkdirSync(join(file, ".."), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // --fullpage captures the whole scrollable route, which is the only way
      // to see panels below the fold (e.g. the reset panel on Database).
      await page.screenshot({ path: file, timeout: 15000, fullPage: args.includes("--fullpage") });
      return true;
    } catch {
      await page.waitForTimeout(600);
    }
  }
  console.log(`  ! screenshot failed: ${file}`);
  return false;
}

try {
  page = await waitForWindow();
  track(page);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);

  await ensureAuthenticated();

  // Reload so the renderer re-reads licence + session from the main process,
  // exactly as a real second launch would.
  if (!(await reload())) {
    const gateText = await page.evaluate(() =>
      (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 160)
    );
    throw new Error(`App shell did not appear after authentication. Screen shows: ${gateText}`);
  }
  console.log("shell reached — walking routes\n");

  let captured = 0;
  const failedRoutes = [];

  // ---------- Pass 1: every route, canonical desktop ----------
  if (!MATRIX_ONLY) {
    const size = { w: 1366, h: 768 };
    await app.evaluate(({ BrowserWindow }, dims) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setContentSize(dims.w, dims.h);
        win.center();
      }
    }, size);
    await page.waitForTimeout(700);

    await page.evaluate(() => {
      localStorage.setItem("mooral.language", "en");
      localStorage.setItem("mooral.theme", "dark");
    });
    await reload();

    for (const route of ROUTES) {
      await gotoRoute(route.path);
      const bodyText = await page.evaluate(() => (document.body.innerText || "").trim());
      const empty = bodyText.length < 40;
      const ok = await shoot(
        join(outRoot, "1366x768", "en", "dark", `${route.name}.png`)
      );
      if (ok) captured++;
      if (empty) failedRoutes.push(`${route.path} (empty render)`);
      console.log(
        `1366x768 en dark /${route.name}${empty ? "  <-- EMPTY" : ""}`
      );
    }
  }

  // ---------- Pass 2: key routes across sizes / languages / themes ----------
  if (!FULL_ONLY) {
    const keys = ROUTES.filter(r => KEY_ROUTE_PATHS.includes(r.path));

    for (const size of SIZES) {
      await app.evaluate(({ BrowserWindow }, dims) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.setContentSize(dims.w, dims.h);
          win.center();
        }
      }, size);
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
          if (!(await reload())) {
            console.log(`${size.w}x${size.h} ${lang} ${theme} -> shell missing, skipped`);
            continue;
          }

          for (const route of keys) {
            await gotoRoute(route.path);
            const ok = await shoot(
              join(outRoot, `${size.w}x${size.h}`, lang, theme, `${route.name}.png`)
            );
            if (ok) captured++;
          }
          console.log(`${size.w}x${size.h} ${lang} ${theme} -> ${keys.length} routes`);
        }
      }
    }
  }

  // ---------- Login screen (verifies the rethemed auth decoration) ----------
  await page.evaluate(() => window.mooral.auth.logout()).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await shoot(join(outRoot, "auth", "login.png"));
  captured++;

  console.log(`\nCaptured ${captured} screenshots under ${outRoot}`);
  if (failedRoutes.length) {
    console.log(`Routes with empty render: ${failedRoutes.length}`);
    for (const r of failedRoutes) console.log(`  - ${r}`);
    process.exitCode = 1;
  }
  console.log(`Renderer errors: ${errors.length}`);
  for (const e of [...new Set(errors)].slice(0, 15)) console.log(`  - ${e}`);
} catch (error) {
  console.error("ROUTE WALK FAILED:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await app.close();
}
