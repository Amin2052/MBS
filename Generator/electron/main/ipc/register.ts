import { ipcMain, dialog, app } from "electron";
import path from "node:path";

import {
  isVaultInitialized,
  setupVault,
  unlockVault,
  verifyRecoveryKey,
  recoverWithRecoveryKey,
  lockVault,
  isUnlocked,
  getCloudSettings,
  saveCloudSettings,
  getVaultLockoutStatus
} from "../vault/vault-manager";

import { hasKeypair, generateAndStoreKeypair, getPublicKeyInfo } from "../crypto/keypair";

import {
  generateNewLicense,
  reExportOriginal,
  createReplacement,
  renewLicense,
  revokeLicense
} from "../license/lifecycle";

import {
  listAllLicenses,
  searchLicenses,
  getLicenseById,
  getAuditHistory,
  getDashboardCounts,
  backupDatabaseTo,
  restoreDatabaseFrom,
  resetDatabase
} from "../db/database";

import { exportRevocationBundle } from "../revocation/export-revocation";

declare const __MBS_GENERATOR_ENV__: "development" | "production";

export function registerIpc(): void {

function requireUnlocked(): void {
  if (!isUnlocked()) throw new Error("Generator vault is locked.");
}

  ipcMain.handle("vault:isInitialized", () => isVaultInitialized());
  ipcMain.handle("vault:isUnlocked", () => isUnlocked());

  ipcMain.handle("vault:setup", (_e, masterPassword: string) => {
    if (!masterPassword || masterPassword.length < 10) {
      throw new Error("Master password must be at least 10 characters.");
    }
    const result = setupVault(masterPassword);
    if (!hasKeypair()) generateAndStoreKeypair();
    return result;
  });

  // AUDIT FIX #4: expose lockout state so the UI can show a clear
  // "too many attempts, try again in X" message instead of a generic
  // "wrong password" after the lockout has already engaged.
  ipcMain.handle("vault:lockoutStatus", () => getVaultLockoutStatus());

  ipcMain.handle("vault:unlock", (_e, masterPassword: string) => {
    const lockout = getVaultLockoutStatus();
    if (lockout.locked) {
      throw new Error(
        `Too many failed attempts. Try again in ${Math.ceil(lockout.retryAfterMs / 60000)} minute(s).`
      );
    }
    return unlockVault(masterPassword);
  });

  ipcMain.handle("vault:verifyRecoveryKey", (_e, recoveryKey: string) => {
    const lockout = getVaultLockoutStatus();
    if (lockout.locked) {
      throw new Error(
        `Too many failed attempts. Try again in ${Math.ceil(lockout.retryAfterMs / 60000)} minute(s).`
      );
    }
    return verifyRecoveryKey(recoveryKey);
  });

  ipcMain.handle("vault:recover", (_e, recoveryKey: string, newPassword: string) => {
    if (!newPassword || newPassword.length < 10) {
      throw new Error("New master password must be at least 10 characters.");
    }
    const lockout = getVaultLockoutStatus();
    if (lockout.locked) {
      throw new Error(
        `Too many failed attempts. Try again in ${Math.ceil(lockout.retryAfterMs / 60000)} minute(s).`
      );
    }
    return recoverWithRecoveryKey(recoveryKey, newPassword);
  });

  ipcMain.handle("vault:lock", () => {
    lockVault();
    return { success: true };
  });

  ipcMain.handle("settings:cloud:get", () => {
    requireUnlocked();
    return getCloudSettings();
  });

  ipcMain.handle("settings:cloud:save", (_e, settings) => {
    requireUnlocked();
    if (!settings || typeof settings !== "object") throw new Error("Invalid cloud settings.");
    saveCloudSettings({
      enabled: Boolean(settings.enabled),
      mode: settings.mode === "customer_managed" ? "customer_managed" : "developer_managed",
      apiUrl: typeof settings.apiUrl === "string" ? settings.apiUrl : "",
      workspaceId: typeof settings.workspaceId === "string" ? settings.workspaceId : "",
      apiKey: typeof settings.apiKey === "string" ? settings.apiKey : ""
    });
    return getCloudSettings();
  });

  ipcMain.handle("keys:info", () => {
    if (!hasKeypair()) return null;
    return { ...getPublicKeyInfo(), environment: __MBS_GENERATOR_ENV__ };
  });

  ipcMain.handle("license:generate", (_e, input) => {
    requireUnlocked();
    return generateNewLicense(input);
  });
  ipcMain.handle("license:reExport", (_e, licenseId: string) => {
    requireUnlocked();
    return reExportOriginal(licenseId);
  });
  ipcMain.handle("license:replace", (_e, licenseId: string, overrides, notes?: string) => {
    requireUnlocked();
    if (!licenseId || typeof licenseId !== "string") throw new Error("License ID is required.");
    return createReplacement(licenseId, overrides ?? {}, notes);
  });
  ipcMain.handle("license:renew", (_e, licenseId: string, newExpirationDate: string | null, notes?: string) => {
    requireUnlocked();
    if (!licenseId || typeof licenseId !== "string") throw new Error("License ID is required.");
    return renewLicense(licenseId, newExpirationDate, notes);
  });
  ipcMain.handle("license:revoke", (_e, licenseId: string, reason?: string) => {
    requireUnlocked();
    if (!licenseId || typeof licenseId !== "string") throw new Error("License ID is required.");

    const record = revokeLicense(licenseId, reason);

    // Return the authoritative persisted record so the renderer can update
    // immediately without relying on stale selected-row state.
    return {
      success: true,
      status: record.status,
      license: record
    };
  });

  ipcMain.handle("license:list", () => { requireUnlocked(); return listAllLicenses(); });
  ipcMain.handle("license:search", (_e, query: string) => { requireUnlocked(); return searchLicenses(typeof query === "string" ? query : ""); });
  ipcMain.handle("license:get", (_e, licenseId: string) => { requireUnlocked(); return getLicenseById(licenseId); });
  ipcMain.handle("license:history", (_e, licenseId: string) => { requireUnlocked(); return getAuditHistory(licenseId); });
  ipcMain.handle("dashboard:counts", () => { requireUnlocked(); return getDashboardCounts(); });

  ipcMain.handle("revocation:export", () => { requireUnlocked(); return exportRevocationBundle(); });

  ipcMain.handle("database:backup", async () => {

    requireUnlocked();

    const defaultName = `mbs-generator-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
    const result = await dialog.showSaveDialog({
      title: "Backup License Database",
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "SQLite Database", extensions: ["sqlite"] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    try {
      // backupDatabaseTo() writes to a side file and only then replaces the
      // destination, so a failed backup never costs the previous one.
      await backupDatabaseTo(result.filePath);
      return { success: true, filePath: result.filePath };
    } catch {
      throw new Error("Could not write the backup file.");
    }

  });

  ipcMain.handle("database:restore", async (_e, confirmation: string) => {

    requireUnlocked();

    // Same server-side confirmation gate as reset — restoring overwrites
    // the live database and is irreversible unless the user has their
    // own backup of the current state.
    if (confirmation !== "RESTORE") {
      throw new Error("Restore was not confirmed.");
    }

    const result = await dialog.showOpenDialog({
      title: "Restore License Database",
      defaultPath: app.getPath("documents"),
      properties: ["openFile"],
      filters: [{ name: "SQLite Database", extensions: ["sqlite"] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const { licensesRestored } = await restoreDatabaseFrom(result.filePaths[0]);
    return { success: true, licensesRestored };

  });

  ipcMain.handle("database:reset", (_e, confirmation: string) => {

    requireUnlocked();

    // Extra server-side confirmation gate — this is destructive and
    // irreversible, so a stray click or scripted call is not enough.
    if (confirmation !== "RESET") {
      throw new Error("Reset was not confirmed.");
    }

    return resetDatabase();

  });

}
