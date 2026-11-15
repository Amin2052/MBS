import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";

import {
  EmployeeClient, ApiError, RevisionConflictError, ORDER_STATUSES, hasPermission,
  type EmployeeSession
} from "../shared/api-client";

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
}

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
    return { apiUrl: String(raw.apiUrl || ""), workspaceId: String(raw.workspaceId || "") };
  } catch {
    return { apiUrl: "", workspaceId: "" };
  }
}

function writeConfig(next: UserConfig): { success: boolean; error?: string } {
  const apiUrl = String(next.apiUrl || "").trim().replace(/\/+$/, "");
  const workspaceId = String(next.workspaceId || "").trim();
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
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ apiUrl, workspaceId }, null, 2), { mode: 0o600 });
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
  return { ...config, signedIn: Boolean(session) };
});

ipcMain.handle("config:set", (_event, input: Partial<UserConfig>) => {
  // Changing where credentials are sent while a session is active would let
  // a later call replay this session against a different server.
  if (session) return { success: false, error: "Sign out before changing the server." };
  return writeConfig({ apiUrl: String(input?.apiUrl || ""), workspaceId: String(input?.workspaceId || "") });
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
    return errorPayload(error);
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
