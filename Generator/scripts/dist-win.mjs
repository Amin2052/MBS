import { spawnSync } from "node:child_process";

const env = { ...process.env, MBS_GENERATOR_ENV: "production" };
for (const command of ["electron-vite build", "electron-builder --win nsis"]) {
  const [bin, ...args] = command.split(" ");
  const result = spawnSync(bin, args, { stdio: "inherit", shell: process.platform === "win32", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
