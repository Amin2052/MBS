// Runs the Generator in dev/hot-reload mode, but signing with the
// PRODUCTION key (its own separate userData profile -- see the
// comment in electron/main/main.ts). Use this whenever you need a
// license that a packaged/installed MBS build will actually trust,
// without waiting on a full `npm run dist:win` build.
import { spawnSync } from "node:child_process";

const env = { ...process.env, MBS_GENERATOR_ENV: "production" };
const result = spawnSync("electron-vite", ["dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env
});
process.exit(result.status ?? 1);
