import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { WindowState } from "../../shared/types/config";

const DEFAULT_STATE: WindowState = {
  width: 1400,
  height: 900,
  isMaximized: false
};

const WINDOW_STATE_FILE = path.join(
  app.getPath("userData"),
  "window-state.json"
);

function isValidState(
  value: Partial<WindowState>
): value is WindowState {
  return (
    typeof value.width === "number" &&
    value.width >= 1200 &&
    typeof value.height === "number" &&
    value.height >= 700 &&
    typeof value.isMaximized === "boolean"
  );
}

export function loadWindowState(): WindowState {
  try {
    if (!fs.existsSync(WINDOW_STATE_FILE)) {
      return DEFAULT_STATE;
    }

    const data = JSON.parse(
      fs.readFileSync(WINDOW_STATE_FILE, "utf-8")
    ) as Partial<WindowState>;

    if (isValidState(data)) {
      return data;
    }
  } catch {}

  return DEFAULT_STATE;
}

export function saveWindowState(window: BrowserWindow): void {
  const bounds = window.isMaximized()
    ? window.getNormalBounds()
    : window.getBounds();

  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: window.isMaximized()
  };

  fs.writeFileSync(
    WINDOW_STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}
