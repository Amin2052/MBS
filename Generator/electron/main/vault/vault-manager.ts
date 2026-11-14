import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  encryptWithSecret,
  decryptWithSecret,
  encryptWithRawKey,
  decryptWithRawKey,
  generateRecoveryKey,
  normalizeRecoveryKeyInput,
  type AeadEnvelope
} from "./vault-crypto";

// ===================================================================
// Vault Manager
//
// vault.json holds two independent AEAD-wrapped copies of the same
// random 32-byte vaultKey: one wrapped under the master password, one
// wrapped under the recovery key. Either secret independently unwraps
// vaultKey. Recovery therefore doesn't "reveal" the private signing
// key any more than normal password login already does — it grants
// the same vault access, then lets the user set a new password (which
// just re-wraps vaultKey under the new password; the recovery
// envelope and the private key blob are untouched).
//
// vaultKey itself never touches disk in plaintext, and only exists in
// memory for the current unlocked session (module-level variable in
// this process, main process only — never sent to the renderer).
// ===================================================================

interface VaultLockoutState {
  failedAttempts: number;
  /** Epoch ms until which unlock/recovery attempts are refused. 0 = not locked. */
  lockedUntilMs: number;
}

interface VaultFile {
  version: 1;
  passwordEnvelope: AeadEnvelope;
  recoveryEnvelope: AeadEnvelope;
  recoveryVerifier: { saltB64: string; hashB64: string };
  createdAt: string;
  /** Encrypted operator settings; absent in v1 files and migrated lazily on save. */
  cloudSettings?: AeadEnvelope;
  /**
   * AUDIT FIX #4: failed master-password / recovery-key attempt
   * tracking, persisted to disk so restarting the app does not reset
   * the count. scrypt already makes each individual guess expensive,
   * but this adds an explicit, escalating lockout on top so sustained
   * automated guessing against either secret is throttled hard.
   * Shared between password unlock and recovery-key attempts since
   * both are guessing a secret that unwraps the same vaultKey -- an
   * attacker must not be able to dodge one counter by switching to
   * the other path. Absent in older vault.json files; treated as
   * "never locked" until the first recorded attempt.
   */
  lockout?: VaultLockoutState;
}

export interface CloudSettings {
  enabled: boolean;
  mode: "developer_managed" | "customer_managed";
  apiUrl: string;
  workspaceId: string;
  apiKey: string;
}

let sessionVaultKey: Buffer | null = null;

function vaultPath(): string {
  return path.join(app.getPath("userData"), "vault.json");
}

export function isVaultInitialized(): boolean {
  return fs.existsSync(vaultPath());
}

function loadVaultFile(): VaultFile {
  return JSON.parse(fs.readFileSync(vaultPath(), "utf8"));
}

function saveVaultFile(v: VaultFile): void {
  fs.writeFileSync(vaultPath(), JSON.stringify(v), { mode: 0o600 });
}

function recoveryVerifierHash(recoveryKey: string, salt: Buffer): Buffer {
  return crypto.scryptSync(recoveryKey, salt, 32, { N: 2 ** 14, r: 8, p: 1 });
}

// --- Lockout (audit fix #4) -----------------------------------------

/** Attempts before any lockout kicks in. */
const LOCKOUT_THRESHOLD = 5;
/** Lockout duration doubles per attempt past the threshold, capped here. */
const LOCKOUT_CAP_MINUTES = 60;

function lockoutDurationMs(attemptNumber: number): number {
  if (attemptNumber < LOCKOUT_THRESHOLD) return 0;
  const minutes = Math.min(LOCKOUT_CAP_MINUTES, 2 ** (attemptNumber - LOCKOUT_THRESHOLD));
  return minutes * 60 * 1000;
}

function currentLockout(file: VaultFile): VaultLockoutState {
  return file.lockout ?? { failedAttempts: 0, lockedUntilMs: 0 };
}

/**
 * Returns whether the vault currently refuses unlock/recovery
 * attempts, and for how much longer. Safe to call before the vault is
 * even initialized (returns not-locked in that case) so the UI can
 * poll it freely.
 */
export function getVaultLockoutStatus(): { locked: boolean; retryAfterMs: number } {
  if (!isVaultInitialized()) return { locked: false, retryAfterMs: 0 };
  const lockout = currentLockout(loadVaultFile());
  const remaining = lockout.lockedUntilMs - Date.now();
  return remaining > 0 ? { locked: true, retryAfterMs: remaining } : { locked: false, retryAfterMs: 0 };
}

function isCurrentlyLockedOut(file: VaultFile): boolean {
  return currentLockout(file).lockedUntilMs > Date.now();
}

function recordFailedAttempt(file: VaultFile): void {
  const lockout = currentLockout(file);
  const nextAttempts = lockout.failedAttempts + 1;
  file.lockout = {
    failedAttempts: nextAttempts,
    lockedUntilMs: (() => {
      const duration = lockoutDurationMs(nextAttempts);
      return duration > 0 ? Date.now() + duration : 0;
    })()
  };
  saveVaultFile(file);
}

function clearLockout(file: VaultFile): void {
  const lockout = currentLockout(file);
  if (lockout.failedAttempts !== 0 || lockout.lockedUntilMs !== 0) {
    file.lockout = { failedAttempts: 0, lockedUntilMs: 0 };
    saveVaultFile(file);
  }
}

/**
 * First-run setup. Returns the recovery key in plaintext exactly
 * once — caller (IPC/UI layer) must display it and never persist it
 * anywhere itself.
 */
export function setupVault(masterPassword: string): { recoveryKey: string } {

  if (isVaultInitialized()) {
    throw new Error("Vault is already initialized.");
  }

  const vaultKey = crypto.randomBytes(32);
  const recoveryKey = generateRecoveryKey();
  const normalizedRecovery = normalizeRecoveryKeyInput(recoveryKey);

  const passwordEnvelope = encryptWithSecret(vaultKey, masterPassword);
  const recoveryEnvelope = encryptWithSecret(vaultKey, normalizedRecovery);

  const verifierSalt = crypto.randomBytes(16);
  const verifierHash = recoveryVerifierHash(normalizedRecovery, verifierSalt);

  const file: VaultFile = {
    version: 1,
    passwordEnvelope,
    recoveryEnvelope,
    recoveryVerifier: {
      saltB64: verifierSalt.toString("base64"),
      hashB64: verifierHash.toString("base64")
    },
    createdAt: new Date().toISOString()
  };

  saveVaultFile(file);
  sessionVaultKey = vaultKey;

  return { recoveryKey };

}

export function unlockVault(masterPassword: string): boolean {

  const file = loadVaultFile();

  if (isCurrentlyLockedOut(file)) return false;

  const vaultKey = decryptWithSecret(file.passwordEnvelope, masterPassword);

  if (!vaultKey) {
    recordFailedAttempt(file);
    return false;
  }

  clearLockout(file);
  sessionVaultKey = vaultKey;
  return true;

}

export function verifyRecoveryKey(recoveryKeyInput: string): boolean {

  const file = loadVaultFile();

  if (isCurrentlyLockedOut(file)) return false;

  const normalized = normalizeRecoveryKeyInput(recoveryKeyInput);

  const salt = Buffer.from(file.recoveryVerifier.saltB64, "base64");
  const expected = Buffer.from(file.recoveryVerifier.hashB64, "base64");
  const actual = recoveryVerifierHash(normalized, salt);

  const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);

  // This is a verification-only check (used before showing the
  // "set new password" step) but it is still a guess against a secret
  // protecting vaultKey, so it must count toward the same lockout as
  // unlockVault()/recoverWithRecoveryKey() -- otherwise an attacker
  // could probe indefinitely through this path alone.
  if (!valid) {
    recordFailedAttempt(file);
  } else {
    clearLockout(file);
  }

  return valid;

}

/**
 * Uses the recovery key to unwrap vaultKey, then rewraps it under a
 * brand-new master password. The old password envelope is discarded.
 */
export function recoverWithRecoveryKey(
  recoveryKeyInput: string,
  newMasterPassword: string
): boolean {

  const file = loadVaultFile();

  if (isCurrentlyLockedOut(file)) return false;

  const normalized = normalizeRecoveryKeyInput(recoveryKeyInput);

  const vaultKey = decryptWithSecret(file.recoveryEnvelope, normalized);
  if (!vaultKey) {
    recordFailedAttempt(file);
    return false;
  }

  clearLockout(file);

  file.passwordEnvelope = encryptWithSecret(vaultKey, newMasterPassword);
  saveVaultFile(file);

  sessionVaultKey = vaultKey;
  return true;

}


export function getCloudSettings(): CloudSettings {
  const defaults: CloudSettings = {
    enabled: false,
    mode: "developer_managed",
    apiUrl: "",
    workspaceId: "",
    apiKey: ""
  };

  if (!sessionVaultKey) throw new Error("Vault is locked.");
  const file = loadVaultFile();
  if (!file.cloudSettings) return defaults;

  try {
    const plaintext = decryptWithRawKey(file.cloudSettings, sessionVaultKey);
    if (!plaintext) return defaults;
    const parsed = JSON.parse(plaintext.toString("utf8"));
    return {
      enabled: Boolean(parsed.enabled),
      mode: parsed.mode === "customer_managed" ? "customer_managed" : "developer_managed",
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : "",
      workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : ""
    };
  } catch {
    // Treat an unreadable/malformed optional settings record as defaults;
    // the vault and signing key remain intact and the user can save again.
    return defaults;
  }
}

export function saveCloudSettings(settings: CloudSettings): void {
  if (!sessionVaultKey) throw new Error("Vault is locked.");

  const normalized: CloudSettings = {
    enabled: Boolean(settings.enabled),
    mode: settings.mode === "customer_managed" ? "customer_managed" : "developer_managed",
    apiUrl: String(settings.apiUrl ?? "").trim(),
    workspaceId: String(settings.workspaceId ?? "").trim(),
    apiKey: String(settings.apiKey ?? "")
  };

  // Customer-managed licenses must not persist developer connection details.
  if (normalized.mode === "customer_managed") {
    normalized.apiUrl = "";
    normalized.workspaceId = "";
    normalized.apiKey = "";
  }

  const file = loadVaultFile();
  file.cloudSettings = encryptWithRawKey(
    Buffer.from(JSON.stringify(normalized), "utf8"),
    sessionVaultKey
  );
  saveVaultFile(file);
}

export function lockVault(): void {
  sessionVaultKey = null;
}

export function isUnlocked(): boolean {
  return sessionVaultKey !== null;
}

/** Main-process-only accessor. Never expose this value via IPC. */
export function getSessionVaultKey(): Buffer {
  if (!sessionVaultKey) throw new Error("Vault is locked.");
  return sessionVaultKey;
}
