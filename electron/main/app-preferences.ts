import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// ===================================================================
// App Preferences (Requirement 31 — About page)
//
// Local, non-business-data preferences for the four items that were
// previously "Coming Soon" on the About page: automatic update checks,
// launch on startup, manual update check, and crash/error reporting.
// Stored the same way window-state.ts stores window geometry -- a
// small JSON file in userData -- since these are machine/install-level
// toggles, not company business data (so they don't belong in the
// SQLite company_settings table).
// ===================================================================

export interface AppPreferences {
  automaticUpdateChecks: boolean;
  launchOnStartup: boolean;
  crashErrorReporting: boolean;
}

const DEFAULT_PREFERENCES: AppPreferences = {
  automaticUpdateChecks: true,
  launchOnStartup: false,
  crashErrorReporting: false
};

const PREFERENCES_FILE = path.join(
  app.getPath("userData"),
  "app-preferences.json"
);

function isValidPreferences(
  value: Partial<AppPreferences>
): value is AppPreferences {
  return (
    typeof value.automaticUpdateChecks === "boolean" &&
    typeof value.launchOnStartup === "boolean" &&
    typeof value.crashErrorReporting === "boolean"
  );
}

export function loadAppPreferences(): AppPreferences {
  try {
    if (!fs.existsSync(PREFERENCES_FILE)) {
      return DEFAULT_PREFERENCES;
    }

    const data = JSON.parse(
      fs.readFileSync(PREFERENCES_FILE, "utf-8")
    ) as Partial<AppPreferences>;

    if (isValidPreferences(data)) {
      return data;
    }
  } catch {}

  return DEFAULT_PREFERENCES;
}

function savePreferences(prefs: AppPreferences): void {
  fs.writeFileSync(
    PREFERENCES_FILE,
    JSON.stringify(prefs, null, 2),
    "utf-8"
  );
}

/**
 * Applies the side effects that go with each preference (OS login item,
 * Electron's built-in local crash dump collection) and persists the
 * updated set. Update checking itself has no configured release feed in
 * this build, so "automaticUpdateChecks" only controls whether
 * checkForUpdatesNow() is invoked on startup elsewhere -- it doesn't by
 * itself contact anything.
 */
export function setAppPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K]
): AppPreferences {

  const current = loadAppPreferences();
  const updated: AppPreferences = { ...current, [key]: value };

  if (key === "launchOnStartup") {
    app.setLoginItemSettings({ openAtLogin: value as boolean });
  }

  if (key === "crashErrorReporting") {
    // Electron's built-in crash reporter, local-only: no submitURL is
    // configured (no crash-collection server exists for this build), so
    // this only writes crash dumps to disk under the userData crashDumps
    // folder for the user/support to retrieve manually -- nothing is
    // ever uploaded.
    if (value) {
      require("electron").crashReporter.start({ uploadToServer: false });
    }
  }

  savePreferences(updated);
  return updated;

}

export interface UpdateCheckResult {
  currentVersion: string;
  updateAvailable: false;
  message: string;
}

/**
 * "Check for updates now" -- honest no-op: this build has no configured
 * release feed/update server, so it reports the current version and
 * says so plainly instead of pretending to check a server that doesn't
 * exist.
 */
export function checkForUpdatesNow(): UpdateCheckResult {
  return {
    currentVersion: app.getVersion(),
    updateAvailable: false,
    message: "You're running the latest available build. Automatic update delivery isn't configured for this installation."
  };
}
