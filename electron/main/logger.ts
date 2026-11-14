import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { LogLevel } from "../../shared/types/logger";

const LOG_FILE = path.join(app.getPath("userData"), "application.log");

function ensureLogFile(): void {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, "", "utf-8");
  }
}

function write(level: LogLevel, message: string): void {
  ensureLogFile();

  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`;

  fs.appendFileSync(LOG_FILE, line, "utf-8");
}

export function logInfo(message: string): void { write("info", message); }
export function logWarn(message: string): void { write("warn", message); }
export function logError(message: string): void { write("error", message); }
export function logDebug(message: string): void { write("debug", message); }
