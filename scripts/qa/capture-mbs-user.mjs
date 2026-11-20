// Screenshot + interaction check for the separate MBS-user application.
//
// Launches the REAL built app (mbs-user/out via its package.json), captures the
// login screen, then exercises the failure path end to end: entering an
// unreachable server and wrong credentials must surface an inline error from
// the main-process IPC call, keep the window on the login screen, and produce
// no renderer errors. Run `npm run build:user` first.
import { _electron as electron } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const outDir = join(process.cwd(), "qa-screenshots", "mbs-user");
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: ["./mbs-user", "--no-sandbox", "--user-data-dir=" + join(process.cwd(), "qa-tmp-mbs-user")],
  cwd: process.cwd()
});

const page = await app.firstWindow({ timeout: 30000 });
const errors = [];
page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
page.on("console", message => {
  // Electron itself logs a harmless sandbox/GPU line on some machines; only
  // renderer-level errors matter here.
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.waitForSelector(".login-card", { timeout: 20000 });
await page.screenshot({ path: join(outDir, "login.png") });

// Server settings may already be expanded on a first run; only toggle it open
// when it is collapsed.
if (!(await page.locator(".server-panel").count())) {
  await page.getByRole("button", { name: /server settings/i }).click();
}

const serverInputs = page.locator(".server-panel input");
const serverAddress = serverInputs.nth(0);
const workspaceIdInput = serverInputs.nth(1);

if (await serverAddress.isDisabled()) {
  console.log("server settings already locked");
} else {
  await serverAddress.fill("http://127.0.0.1:9");
  await workspaceIdInput.fill("qa-workspace");
}

await page.fill('input[autocomplete="username"]', "qa.employee");
await page.fill('input[autocomplete="current-password"]', "WrongPass!1");
await page.getByRole("button", { name: "Sign in" }).click();

await page.waitForSelector(".banner-error", { timeout: 20000 });
const message = (await page.locator(".banner-error").innerText()).trim();
await page.screenshot({ path: join(outDir, "login-error.png") });

const stillOnLogin = await page.locator(".login-card").count();
const dashboardVisible = await page.locator(".app-shell").count();

await app.close();

const ok = message.length > 0 && stillOnLogin === 1 && dashboardVisible === 0 && errors.length === 0;
console.log(JSON.stringify({ message, stillOnLogin, dashboardVisible, errors, ok }, null, 2));
process.exit(ok ? 0 : 1);
