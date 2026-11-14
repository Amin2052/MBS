import { app, BrowserWindow } from "electron";
import path from "node:path";

import { registerIpc } from "./ipc/register";

declare const __MBS_GENERATOR_ENV__: "development" | "production";

// ===================================================================
// Environment-separated profiles
//
// Previously the Generator always used Electron's single default
// userData folder regardless of how it was launched, so whichever
// signing key got generated on first-ever run (typically a
// "development" key, since `npm run dev` is what people reach for)
// was permanently locked in for that machine -- switching
// MBS_GENERATOR_ENV to "production" later did NOT produce a new
// production key, because generateAndStoreKeypair() only ever runs
// once, the first time the vault is set up. There was no way to hold
// a real development key and a real production key side by side.
//
// Fix: a "production" launch (`npm run dev:prod`, or a packaged build
// via `npm run dist:win`, which already forces this env) gets its own
// separate userData folder. A plain "development" launch keeps using
// Electron's normal default folder, so nothing about any existing
// install changes. This lets an operator keep a permanent
// development vault (fast iteration, always-rejected-by-packaged-
// -builds keys, safe to test with) and a permanent production vault
// (the one whose public key actually belongs in MBS's trusted-keys.ts)
// on the same machine, switching between them with one command, with
// neither ever overwriting the other.
// ===================================================================

if (__MBS_GENERATOR_ENV__ === "production") {
  app.setPath("userData", path.join(app.getPath("userData"), "..", "mooral-generator-production"));
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 760,
    minHeight: 500,
    title: "MBS License Generator",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload script only uses contextBridge/ipcRenderer (see
      // preload.ts) and the renderer is plain React with no other Node
      // API needs, so the sandbox can be enabled with no functional
      // change. This is an administrative tool that handles the signing
      // vault and customer license data — worth the extra containment.
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // This app never needs to open new windows or navigate away from its
  // own bundled UI. Deny both outright rather than trusting nothing ever
  // triggers them (e.g. a stray target="_blank" link, an <a href> to an
  // external URL, or a compromised/renderer-injected navigation).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isDevServer = Boolean(process.env.ELECTRON_RENDERER_URL) && url.startsWith(process.env.ELECTRON_RENDERER_URL!);
    const isOwnFile = url.startsWith("file://");
    if (!isDevServer && !isOwnFile) {
      event.preventDefault();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

}

registerIpc();

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
