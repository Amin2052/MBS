import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// MBS-user is built from the same repository so it can reuse the same
// toolchain, but it is a separate application: its own entry points, its own
// output directory, its own package.json identity and installer config.
export default defineConfig({
  main: {
    build: {
      outDir: resolve(__dirname, "out/main"),
      rollupOptions: { input: resolve(__dirname, "main/index.ts") }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      outDir: resolve(__dirname, "out/preload"),
      rollupOptions: { input: resolve(__dirname, "preload/preload.ts") }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, "renderer"),
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: { input: resolve(__dirname, "renderer/index.html") }
    },
    plugins: [react()]
  }
});
