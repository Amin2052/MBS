import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const generatorEnvironment = process.env.MBS_GENERATOR_ENV === "production" ? "production" : "development";

export default defineConfig({
  main: {
    resolve: { alias: { "@": resolve(__dirname, "src") } },
    define: { __MBS_GENERATOR_ENV__: JSON.stringify(generatorEnvironment) },
    build: {
      rollupOptions: { input: resolve(__dirname, "electron/main/main.ts") }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: { alias: { "@": resolve(__dirname, "src") } },
    build: { rollupOptions: { input: resolve(__dirname, "electron/preload/preload.ts") } },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: ".",
    build: { rollupOptions: { input: resolve(__dirname, "index.html") } },
    resolve: { alias: { "@": resolve(__dirname, "src") } },
    plugins: [react()]
  }
});
