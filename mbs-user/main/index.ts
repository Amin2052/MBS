import { app, BrowserWindow, ipcMain } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  EmployeeClient, ApiError, RevisionConflictError, ORDER_STATUSES, hasPermission,
  type EmployeeSession
} from "../shared/api-client";
import { DEFAULT_API_URL, DEFAULT_WORKSPACE_ID } from "../shared/default-config";

// ===================================================================
// MBS-user — employee client, main process
//
// A deliberately thin application. It owns no database and keeps no
// business records on disk: everything it shows comes from the central
// Worker, which is the same D1 database the owner's MBS installation syncs
// to. That is what makes "all employees work on the same records" true by
// construction instead of by reconciliation.
//
// Security boundaries enforced HERE (not only in the renderer):
//   - the session token lives in main-process memory only; it is never
//     written to disk and never exposed to the renderer;
//   - the workspace API key does not exist in this codebase at all;
//   - every IPC call re-checks the permission it needs against the freshly
//     loaded grant list, and the Worker re-checks again server-side;
//   - the app's own data folder is separate from MBS's, so installing or
//     running MBS-user can never touch the owner's database or license.
// ===================================================================

app.setName("MBS-user");
app.setPath("userData", path.join(app.getPath("appData"), "MBS-user"));
app.setAppUserModelId("com.mooral.mbsuser");

interface UserConfig {
  apiUrl: string;
  workspaceId: string;
  settingsLock?: string;
}

// Every installation starts locked with this shared default password, so server
// settings are protected before an administrator has configured anything. There
// is no UI to change them any more; the lock only exists as a backstop for any
// future in-app configuration path.
const DEFAULT_ADMIN_PASSWORD = "1234567890";

interface ConnectionState {
  online: boolean;
  detail: string;
  checkedAt: string;
}

const COLLECTION_PERMISSION: Record<string, string> = {
  orders: "orders.view",
  customers: "customers.view",
  products: "products.view",
  invoices: "invoices.view"
};

let mainWindow: BrowserWindow | null = null;
let session: EmployeeSession | null = null;
let monitor: NodeJS.Timeout | null = null;
let connection: ConnectionState = { online: false, detail: "Not checked yet.", checkedAt: "" };

function configPath(): string {
  return path.join(app.getPath("userData"), "mbs-user-config.json");
}

function readConfig(): UserConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<UserConfig>;
    return {
      // Fall back to the built-in deployment so a fresh install can sign in.
      apiUrl: String(raw.apiUrl || DEFAULT_API_URL),
      workspaceId: String(raw.workspaceId || DEFAULT_WORKSPACE_ID),
      // "" is an explicit "no lock" written by Remove lock; a missing key means
      // the installation is still on the default password.
      settingsLock: typeof raw.settingsLock === "string" ? raw.settingsLock : undefined
    };
  } catch {
    return { apiUrl: DEFAULT_API_URL, workspaceId: DEFAULT_WORKSPACE_ID };
  }
}

// The administrator password is stored as a salted scrypt hash. It never
// leaves the main process: config:get reports only whether a lock exists.
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPassword(password: string, stored: string): boolean {
  // Older installs stored the password in plain text; still accept it so an
  // existing lock can be unlocked and then migrated to a hash.
  if (!stored.startsWith("scrypt:")) return safeEqual(password, stored);
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// The verifier currently protecting server settings: a stored lock, the
// default password when nothing has been stored yet, or null when an
// administrator has removed the lock entirely.
function activeLock(config: UserConfig): string | null {
  if (config.settingsLock === "") return null;
  return config.settingsLock ?? DEFAULT_ADMIN_PASSWORD;
}

// Set only after the administrator verified the lock password in this run, so
// the lock re-applies the next time the app starts.
let settingsUnlocked = false;

// The server address and workspace can no longer be typed into the app (the
// sign-in page shows no server settings at all), so an administrator provisions
// a PC either by writing mbs-user-config.json or by passing the two values on
// the command line, e.g. from a deployment shortcut:
//   MBS-user.exe --api-url=https://mbs-cloud.example.workers.dev --workspace=acme-trading
// Command-line provisioning counts as an administrator action, so it is allowed
// even while the settings lock is in force.
function applyProvisioningArgs(): void {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(1)) {
    const match = /^--(api-url|workspace|workspace-id)=(.*)$/.exec(arg);
    if (!match) continue;
    const value = match[2].trim();
    if (value) flags.set(match[1], value);
  }

  const apiUrl = flags.get("api-url");
  const workspaceId = flags.get("workspace") ?? flags.get("workspace-id");
  if (!apiUrl && !workspaceId) return;

  const current = readConfig();
  const sameUrl = !apiUrl || apiUrl === current.apiUrl;
  const sameWorkspace = !workspaceId || workspaceId === current.workspaceId;
  if (sameUrl && sameWorkspace) return;

  settingsUnlocked = true;
  try {
    const result = writeConfig({ apiUrl, workspaceId });
    if (!result.success) console.error("[MBS-user] Could not apply provisioning flags:", result.error);
  } finally {
    settingsUnlocked = false;
  }
}

function writeConfig(patch: {
  apiUrl?: string;
  workspaceId?: string;
  settingsLock?: string | null;
}): { success: boolean; error?: string } {

  const current = readConfig();
  const apiUrl = patch.apiUrl !== undefined
    ? String(patch.apiUrl).trim().replace(/\/+$/, "")
    : current.apiUrl;
  const workspaceId = patch.workspaceId !== undefined
    ? String(patch.workspaceId).trim()
    : current.workspaceId;

  if (apiUrl) {
    try {
      const parsed = new URL(apiUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
    } catch {
      return { success: false, error: "Server address must be a valid http(s) URL." };
    }
  }
  if (workspaceId && !/^[A-Za-z0-9_-]{3,80}$/.test(workspaceId)) {
    return { success: false, error: "Workspace id must be 3-80 letters, digits, '-' or '_'." };
  }

  // A lock points employees at one server. Writing a different address has to
  // be refused here, not only hidden in the UI.
  if (activeLock(current) !== null && !settingsUnlocked && (apiUrl !== current.apiUrl || workspaceId !== current.workspaceId)) {
    return { success: false, error: "Server settings are locked. Unlock them with the administrator password first." };
  }

  // undefined keeps whatever is stored, null removes the lock (stored as ""),
  // a string replaces it.
  const settingsLock = patch.settingsLock === undefined
    ? current.settingsLock
    : (patch.settingsLock === null ? "" : String(patch.settingsLock));

  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ apiUrl, workspaceId, ...(settingsLock !== undefined ? { settingsLock } : {}) }, null, 2), { mode: 0o600 });
  return { success: true };
}

function client(): EmployeeClient {
  const config = readConfig();
  return new EmployeeClient({ baseUrl: config.apiUrl, workspaceId: config.workspaceId });
}

/** Never includes the token: the renderer has no use for it and cannot leak
 *  what it never receives. */
function publicSession() {
  if (!session) return null;
  const { user, permissions, unrestricted, resetEpoch, expiresAt } = session;
  return { user, permissions, unrestricted, resetEpoch, expiresAt };
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function errorPayload(error: unknown): { success: false; error: string; code?: string; status?: number; offline?: boolean; forbidden?: boolean; conflict?: boolean } {
  if (error instanceof RevisionConflictError) {
    // `conflict` is the flag the renderer acts on to reload the list; the
    // code alone was returned, so a conflict left the stale row on screen.
    return { success: false, error: error.message, code: "revision_conflict", status: 409, conflict: true };
  }
  if (error instanceof ApiError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      status: error.status,
      offline: error.code === "offline" || error.status === 0,
      forbidden: error.status === 403
    };
  }
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

function stopMonitor(): void {
  if (monitor) clearInterval(monitor);
  monitor = null;
}

function startMonitor(): void {
  stopMonitor();
  // Permission changes made by the owner in MBS reach this client within one
  // interval -- and, more importantly, the Worker has already enforced them
  // on every request before this refresh even happens.
  monitor = setInterval(() => {
    void refreshSession();
    void checkConnection();
  }, 45_000);
}

async function refreshSession(): Promise<EmployeeSession | null> {
  if (!session) return null;
  const token = session.token;
  try {
    const next = await client().permissions(token);
    // If the user signed out (or signed in as someone else) while this
    // request was in flight, do not resurrect the old session from it.
    if (!session || session.token !== token) return null;
    session = {
      ...session,
      user: next.user,
      permissions: next.permissions,
      unrestricted: next.unrestricted,
      resetEpoch: next.resetEpoch
    };
    broadcast("session:changed", { session: publicSession() });
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      session = null;
      stopMonitor();
      broadcast("session:changed", {
        session: null,
        reason: "Your access was revoked or your session expired. Sign in again."
      });
      return null;
    }
    // Offline: keep the session so the user is not thrown out by a dropped
    // connection. Writes are still refused while the server is unreachable.
    broadcast("connection:changed", connection);
    return session;
  }
}

async function checkConnection(): Promise<ConnectionState> {
  const previous = connection.online;
  try {
    await client().health();
    connection = { online: true, detail: "Connected to the central server.", checkedAt: new Date().toISOString() };
  } catch (error) {
    connection = {
      online: false,
      detail: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString()
    };
  }
  if (previous !== connection.online) broadcast("connection:changed", connection);
  return connection;
}

// --------------------------- IPC ---------------------------

ipcMain.handle("config:get", () => {
  const config = readConfig();
  // The hash stays in main: the renderer only learns whether a lock is set.
  return {
    apiUrl: config.apiUrl,
    workspaceId: config.workspaceId,
    settingsLocked: activeLock(config) !== null,
    settingsUnlocked,
    signedIn: Boolean(session)
  };
});

ipcMain.handle("config:set", (_event, input: { apiUrl?: string; workspaceId?: string }) => {
  // Changing where credentials are sent while a session is active would let
  // a later call replay this session against a different server.
  if (session) return { success: false, error: "Sign out before changing the server." };
  return writeConfig({
    apiUrl: input?.apiUrl !== undefined ? String(input.apiUrl) : undefined,
    workspaceId: input?.workspaceId !== undefined ? String(input.workspaceId) : undefined
  });
});

// Verifies the administrator password and, on success, unlocks server settings
// for this run only.
ipcMain.handle("config:unlock", (_event, input: { password?: string }) => {
  const config = readConfig();
  const lock = activeLock(config);
  if (lock === null) {
    settingsUnlocked = true;
    return { success: true };
  }
  const password = String(input?.password ?? "");
  if (!verifyPassword(password, lock)) {
    return { success: false, error: "Incorrect administrator password." };
  }
  settingsUnlocked = true;
  // Migrate an old plain-text lock to a salted hash. The shipped default is
  // left as-is so a new installation keeps working with the documented password.
  if (!lock.startsWith("scrypt:") && lock !== DEFAULT_ADMIN_PASSWORD) {
    writeConfig({ settingsLock: hashPassword(password) });
  }
  return { success: true };
});

// Re-applies the existing lock after an unlocked session is finished.
ipcMain.handle("config:relock", () => {
  settingsUnlocked = false;
  return { success: true };
});

// Sets, changes or removes the lock. Changing or removing an existing lock
// needs it to be unlocked first (i.e. the current password was entered).
ipcMain.handle("config:setLock", (_event, input: { password?: string | null }) => {
  const config = readConfig();
  if (activeLock(config) !== null && !settingsUnlocked) {
    return { success: false, error: "Enter the current administrator password first." };
  }
  if (input?.password === null || input?.password === "") {
    const removed = writeConfig({ settingsLock: null });
    if (removed.success) settingsUnlocked = false;
    return removed;
  }
  const password = String(input?.password ?? "");
  if (password.length < 6) {
    return { success: false, error: "Use an administrator password of at least 6 characters." };
  }
  const result = writeConfig({ settingsLock: hashPassword(password) });
  if (result.success) settingsUnlocked = false;
  return result;
});

ipcMain.handle("auth:login", async (_event, input: { username?: string; password?: string }) => {
  const config = readConfig();
  if (!config.apiUrl || !config.workspaceId) {
    return { success: false, error: "Enter the server address and workspace id first." };
  }
  const username = String(input?.username || "").trim();
  const password = String(input?.password || "");
  if (!username || !password) return { success: false, error: "Employee ID and password are required." };

  try {
    session = await new EmployeeClient({ baseUrl: config.apiUrl, workspaceId: config.workspaceId }).login(username, password);
    startMonitor();
    void checkConnection();
    return { success: true, session: publicSession() };
  } catch (error) {
    const payload = errorPayload(error);
    // Say WHICH server and workspace were tried. "Incorrect ID or password"
    // is otherwise indistinguishable from "this PC is pointed at the wrong
    // workspace/server", which is the usual cause when the credentials are right.
    let host = config.apiUrl;
    try { host = new URL(config.apiUrl).host; } catch { /* keep raw value */ }
    return { ...payload, error: `${payload.error} (server ${host}, workspace ${config.workspaceId})` };
  }
});

ipcMain.handle("auth:logout", async () => {
  const token = session?.token;
  session = null;
  stopMonitor();
  if (token) await client().logout(token);
  broadcast("session:changed", { session: null });
  return { success: true };
});

ipcMain.handle("session:refresh", async () => {
  const refreshed = await refreshSession();
  return { success: true, session: publicSession(), signedOut: !refreshed };
});

ipcMain.handle("data:list", async (_event, collection: string) => {
  if (!session) return { success: false, error: "Not signed in." };
  const required = COLLECTION_PERMISSION[String(collection)];
  if (!required) return { success: false, error: "Unsupported collection." };
  if (!hasPermission(session, required)) {
    return { success: false, error: "You do not have permission to view this.", forbidden: true };
  }
  try {
    return { success: true, rows: await client().list(session.token, String(collection)) };
  } catch (error) {
    return errorPayload(error);
  }
});

ipcMain.handle("orders:updateStatus", async (_event, input: { localId?: string; status?: string; expectedRevision?: number }) => {
  if (!session) return { success: false, error: "Not signed in." };
  if (!hasPermission(session, "orders.edit")) {
    return { success: false, error: "You do not have permission to update orders.", forbidden: true };
  }
  const status = String(input?.status || "");
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
    return { success: false, error: `Unknown order status '${status}'.` };
  }
  try {
    const result = await client().updateOrderStatus(session.token, String(input?.localId || ""), status, Number(input?.expectedRevision));
    return { success: true, syncRevision: result.syncRevision };
  } catch (error) {
    return errorPayload(error);
  }
});

ipcMain.handle("connection:check", async () => checkConnection());

// ------------------------- window --------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "MBS-user",
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  // This app only ever shows its own local renderer; nothing may navigate it
  // away or open an external window with the privileged preload attached.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    applyProvisioningArgs();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    stopMonitor();
    if (process.platform !== "darwin") app.quit();
  });
}
