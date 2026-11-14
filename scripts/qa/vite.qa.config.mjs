/**
 * QA-only Vite config for the renderer.
 *
 * electron/main/main.ts decides `isDev = !app.isPackaged`, so an unpackaged
 * Electron run (which is how Playwright's _electron.launch starts the app)
 * always loads http://localhost:5173 instead of out/renderer/index.html.
 * This config serves exactly that URL (same root, same `@` alias as
 * electron.vite.config.ts's renderer section) so the real app can be booted
 * and visually inspected without packaging an installer.
 *
 * It is used only by scripts/qa/smoke-electron.mjs. It does not affect
 * `npm run dev`, `npm run build` or any shipped artifact.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const root = process.cwd();

export default defineConfig({
  root,
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1"
  },
  resolve: {
    alias: {
      "@": resolve(root, "src"),
      "@shared": resolve(root, "shared")
    }
  },
  plugins: [react()]
});
