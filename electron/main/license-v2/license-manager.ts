import { app } from "electron";
import { getMachineFingerprint } from "./crypto/machine-fingerprint";
import { verifySignedLicense } from "./license/verify-license";
import { saveActivation, loadActivation, clearActivation } from "./storage/secure-storage";
import { importRevocationBundle, getRevocationStatus } from "./license/revocation";
import type { ActivationPackageV1, LicenseValidationResult, BusinessMode } from "./license/schema";
import { resolveBusinessMode } from "./license/schema";
import { isValidActivationCode, normalizeActivationCode } from "./license/activation-code";
import { getTrialStatus } from "./storage/trial-storage";
import { decryptEncryptedLicenseFile } from "./license/encrypted-license-file";
import { clearCustomerCloudConfigAndPreference } from "../cloud/cloud-config-service";

// ===================================================================
// License Manager (MBS side)
//
// The single entry point the IPC layer talks to. Every method here
// re-verifies the stored license from scratch (signature, expiry,
// machine, revocation) rather than trusting a cached boolean — there
// is deliberately no "isLicensed" flag anywhere that isn't the direct
// result of verifySignedLicense() on the current call.
// ===================================================================

/**
 * A packaged build (the only thing customers ever run) must never
 * trust a `development`-environment signing key. `npm run dev` /
 * `electron-vite dev` runs unpackaged, so `app.isPackaged` is exactly
 * the "production build" signal this needs. Every verifySignedLicense
 * call in this file must pass this through explicitly rather than
 * relying on the (fail-safe = false) default.
 */
function licenseKeyOptions(): { allowDevelopmentKeys: boolean } {
  return { allowDevelopmentKeys: !app.isPackaged };
}


export interface LicenseStatusView {
  activated: boolean;
  status: LicenseValidationResult["status"] | "not_activated" | "trial";
  trialExpiresAt?: string;
  reason?: string;
  licenseId?: string;
  customerName?: string;
  companyName?: string;
  licenseType?: string;
  expirationDate?: string | null;
  /** Business Mode entitlement. This is the only product entitlement
   * exposed to the renderer; module access and Starter quotas derive from
   * this validated, signed mode. */
  businessMode?: BusinessMode;
}

function decodeLicenseKey(licenseKey: string): unknown {

  // Accepts either a raw JSON blob (pasted from a .lic file) or a
  // base64url-wrapped JSON string (the compact "license key" format
  // customers can copy/paste as text).
  const trimmed = licenseKey.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf8");

  return JSON.parse(json);

}

// Reads back whatever WAS active (unverified -- this is only ever used as
// a heuristic for "did the license identity change", never as a security
// decision; the actual new license is still fully verified at both call
// sites below) and returns its claimed licenseId, or null if there was
// nothing stored or it doesn't parse. See the call sites in
// activate()/activateFromFile() and the comment on
// clearCustomerCloudConfigAndPreference() in cloud-config-service.ts for
// why this exists: a stale customer_managed cloud config (apiUrl/
// workspaceId/apiKey) must not silently survive from one customer's
// license onto a different one activated later on the same installation.
function previouslyActiveLicenseId(): string | null {
  try {
    const raw = loadActivation();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload?: { licenseId?: string } };
    return typeof parsed?.payload?.licenseId === "string" ? parsed.payload.licenseId : null;
  } catch {
    return null;
  }
}

// Call BEFORE saveActivation() overwrites the stored activation, with the
// NEW license's own claimed licenseId -- compares against whatever was
// previously active and wipes the customer-managed cloud config/enabled
// preference if the identity actually changed. Re-activating the SAME
// license (renewal, re-running the same activation code) leaves the
// customer's own configured cloud settings untouched, since nothing
// about who owns this installation's data actually changed.
function clearStaleCloudConfigIfLicenseChanged(newLicenseId: string | undefined | null): void {
  const previousLicenseId = previouslyActiveLicenseId();
  if (previousLicenseId && newLicenseId && previousLicenseId === newLicenseId) return;
  if (!previousLicenseId && !newLicenseId) return; // nothing before, nothing identifiable now -- no-op either way
  clearCustomerCloudConfigAndPreference();
}

export class LicenseManagerV2 {

  getMachineId(): string {
    return getMachineFingerprint();
  }

  getStatus(): LicenseStatusView {

    const stored = loadActivation();

    if (!stored) {
      const trial = getTrialStatus();
      if (trial.active) {
        return {
          activated: true,
          status: "trial",
          trialExpiresAt: trial.expiresAt,
          customerName: trial.profile?.ownerFullName,
          companyName: trial.profile?.companyName,
          businessMode: "starter"
        };
      }
      if (trial.used) {
        return {
          activated: false,
          status: "expired",
          reason: "Your 7-day trial has expired.",
          trialExpiresAt: trial.expiresAt,
          customerName: trial.profile?.ownerFullName,
          companyName: trial.profile?.companyName
        };
      }
      return { activated: false, status: "not_activated" };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(stored);
    } catch {
      return { activated: false, status: "invalid_format", reason: "Stored license is unreadable." };
    }

    const result = verifySignedLicense(parsed, getMachineFingerprint(), licenseKeyOptions());

    if (!result.valid) {
      return {
        activated: false,
        status: result.status,
        reason: result.reason,
        licenseId: result.payload?.licenseId
      };
    }

    return {
      activated: true,
      status: "valid",
      licenseId: result.payload!.licenseId,
      customerName: result.payload!.customerName,
      companyName: result.payload!.companyName,
      licenseType: result.payload!.licenseType,
      expirationDate: result.payload!.expirationDate,
      businessMode: resolveBusinessMode(result.payload!)
    };

  }

  activateCompact(activationCode: string, licenseFileText: string): LicenseStatusView {

    const code = normalizeActivationCode(activationCode);

    if (!isValidActivationCode(code)) {
      return {
        activated: false,
        status: "invalid_format",
        reason: "Activation code must contain 20 alphanumeric characters."
      };
    }

    if (typeof licenseFileText !== "string" || !licenseFileText.trim()) {
      return {
        activated: false,
        status: "invalid_format",
        reason: "A license file is required."
      };
    }

    if (licenseFileText.length > 500_000) {
      return {
        activated: false,
        status: "invalid_format",
        reason: "The license file is too large."
      };
    }

    let decrypted: { activationCode: string; signedLicense: unknown };

    try {
      decrypted = decryptEncryptedLicenseFile(
        licenseFileText,
        code,
        getMachineFingerprint()
      );
    } catch (error: any) {
      return {
        activated: false,
        status: "invalid_format",
        reason: error?.message ?? "Could not read the license file."
      };
    }

    if (normalizeActivationCode(decrypted.activationCode) !== code) {
      return {
        activated: false,
        status: "invalid_format",
        reason: "Activation code does not match the license file."
      };
    }

    const signed = decrypted.signedLicense as any;
    const signedCode = normalizeActivationCode(
      signed?.payload?.activationCode ?? ""
    );

    if (signedCode !== code) {
      return {
        activated: false,
        status: "invalid_format",
        reason: "Activation code does not match the signed license."
      };
    }

    const result = verifySignedLicense(
      decrypted.signedLicense,
      getMachineFingerprint(),
      licenseKeyOptions()
    );

    if (!result.valid) {
      return {
        activated: false,
        status: result.status,
        reason: result.reason
      };
    }

    // Must run before saveActivation() overwrites the previously stored
    // activation -- see the comment on clearStaleCloudConfigIfLicenseChanged().
    clearStaleCloudConfigIfLicenseChanged(result.payload?.licenseId);
    saveActivation(JSON.stringify(decrypted.signedLicense));
    return this.getStatus();
  }

  activate(licenseKey: string): LicenseStatusView {

    let parsed: unknown;

    try {
      parsed = decodeLicenseKey(licenseKey);
    } catch {
      return { activated: false, status: "invalid_format", reason: "License key is not valid." };
    }

    const result = verifySignedLicense(parsed, getMachineFingerprint(), licenseKeyOptions());

    if (!result.valid) {
      return { activated: false, status: result.status, reason: result.reason };
    }

    // Must run before saveActivation() overwrites the previously stored
    // activation -- see the comment on clearStaleCloudConfigIfLicenseChanged().
    clearStaleCloudConfigIfLicenseChanged(result.payload?.licenseId);
    saveActivation(JSON.stringify(parsed));

    return this.getStatus();

  }

  deactivate(): { success: boolean } {
    clearActivation();
    return { success: true };
  }

  /**
   * Returns the developer-managed cloud/API/integration configuration
   * carried inside the currently active, signature-verified license --
   * or null if there is no valid license, or the valid license carries no
   * licensedCloudConfig. Re-verifies from scratch every call (same
   * philosophy as getStatus()); callers must never cache this beyond a
   * single operation and must never accept a substitute value from the
   * renderer or any other unsigned source.
   */
  getVerifiedCloudConfig(): { enabled: boolean; mode: "developer_managed" | "customer_managed"; apiUrl: string; workspaceId: string; apiKey: string } | null {

    const stored = loadActivation();
    if (!stored) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      return null;
    }

    const result = verifySignedLicense(parsed, getMachineFingerprint(), licenseKeyOptions());
    if (!result.valid || !result.payload) return null;

    const cc = result.payload.licensedCloudConfig;
    if (!cc) return null;

    // Absent mode = license issued before "mode" existed -- always the
    // developer-managed meaning back then, never reinterpret as customer_managed.
    return { ...cc, mode: cc.mode === "customer_managed" ? "customer_managed" : "developer_managed" };

  }

  importRevocationBundle(bundleJson: string) {
    return importRevocationBundle(bundleJson);
  }

  getRevocationStatus() {
    return getRevocationStatus();
  }

}

export const licenseManagerV2 = new LicenseManagerV2();
