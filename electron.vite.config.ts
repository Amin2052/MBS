import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@shared": resolve(__dirname, "shared")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/main/main.ts")
      }
    },
    plugins: [externalizeDepsPlugin()]
  },

  preload: {
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@shared": resolve(__dirname, "shared")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/preload/preload.ts")
      }
    },
    plugins: [externalizeDepsPlugin()]
  },

  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html")
      }
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@shared": resolve(__dirname, "shared")
      }
    },
    plugins: [react()]
  }
});
