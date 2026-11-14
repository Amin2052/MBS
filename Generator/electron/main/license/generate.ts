import crypto from "node:crypto";

import type { LicensePayloadV1, SignedLicense, LicenseType, BusinessMode } from "./schema";
type LicensedCloudConfig = NonNullable<LicensePayloadV1["licensedCloudConfig"]>;
import { canonicalBytes } from "../crypto/canonicalize";
import { signBytes } from "../crypto/keypair";
import { getPublicKeyInfo } from "../crypto/keypair";
import { generateActivationCode } from "./activation-code";
import { createEncryptedLicenseFile } from "./encrypted-license-file";

export interface GenerateLicenseInput {
  customerName: string;
  companyName: string;
  licenseType: LicenseType;
  expirationDate: string | null;
  machineFingerprint: string;
  supersedesLicenseId?: string;
  relationship?: LicensePayloadV1["relationship"];
  /** Business Mode entitlement selected on the Generator side (Phase 2,
   * item 5). Required — every newly generated license must carry an
   * explicit mode so MBS never has to guess. */
  businessMode: BusinessMode;
  /** Optional cloud/API/integration entitlement. Omit entirely for a
   * license with no cloud entitlement (matches MBS's "absent = no
   * licensed cloud configuration" contract). */
  licensedCloudConfig?: LicensedCloudConfig;
}

export function newLicenseId(): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `MBS-${year}-${rand}`;
}

const LICENSE_TYPES = new Set<LicenseType>(["trial", "standard", "professional", "enterprise"]);
const BUSINESS_MODES = new Set<BusinessMode>(["starter", "enterprise"]);

function requireText(value: unknown, field: string, maxLength = 300): string {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`${field} is too long.`);
  return normalized;
}

function validateGenerateInput(input: GenerateLicenseInput): GenerateLicenseInput {
  const customerName = requireText(input.customerName, "Customer name");
  const companyName = requireText(input.companyName, "Company name");
  const machineFingerprint = requireText(input.machineFingerprint, "Machine ID", 500);

  if (!LICENSE_TYPES.has(input.licenseType)) throw new Error("Invalid license type.");
  if (!BUSINESS_MODES.has(input.businessMode)) throw new Error("Invalid Business Mode.");
  if (input.expirationDate !== null) {
    if (typeof input.expirationDate !== "string" || Number.isNaN(Date.parse(input.expirationDate))) {
      throw new Error("Invalid expiration date.");
    }
  }

  if (input.supersedesLicenseId !== undefined && !/^MBS-\d{4}-[0-9A-F]{8}$/.test(input.supersedesLicenseId)) {
    throw new Error("Invalid predecessor license ID.");
  }

  const licensedCloudConfig = validateCloudConfig(input.licensedCloudConfig);

  return { ...input, customerName, companyName, machineFingerprint, licensedCloudConfig };
}

/**
 * Validates and normalizes the optional cloud entitlement. Mirrors MBS's
 * own structural rules for this field exactly (see schema.ts):
 *  - "developer_managed" (the default) carries the real apiUrl/workspaceId/
 *    apiKey the Generator operator enters here.
 *  - "customer_managed" grants only the entitlement; MBS expects these
 *    three fields to be empty for that mode, since the real values come
 *    from the customer's own local configuration, never from the license.
 * Returns undefined when no cloud config was supplied at all, which MBS
 * treats as "no licensed cloud configuration" -- distinct from `enabled:
 * false`, which still leaves the entitlement's other fields significant
 * for a later re-enable.
 */
function validateCloudConfig(input: LicensedCloudConfig | undefined): LicensedCloudConfig | undefined {

  if (input === undefined) return undefined;
  if (!input || typeof input !== "object") throw new Error("Invalid cloud configuration.");

  if (typeof input.enabled !== "boolean") throw new Error("Cloud configuration 'enabled' must be true or false.");

  const mode = input.mode === "customer_managed" ? "customer_managed" : "developer_managed";

  if (mode === "customer_managed") {
    // The license only grants the entitlement; MBS never reads these values
    // for customer_managed mode, so they must be sent empty rather than
    // silently carrying developer connection details a customer isn't
    // meant to receive embedded in their license file.
    return { enabled: input.enabled, mode, apiUrl: "", workspaceId: "", apiKey: "" };
  }

  const apiUrl = typeof input.apiUrl === "string" ? input.apiUrl.trim() : "";
  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey : "";

  if (input.enabled && (!apiUrl || !workspaceId || !apiKey)) {
    throw new Error("Developer-managed cloud configuration requires an API URL, workspace ID, and API key when enabled.");
  }

  if (apiUrl.length > 2000 || workspaceId.length > 500 || apiKey.length > 2000) {
    throw new Error("Cloud configuration value is too long.");
  }

  return { enabled: input.enabled, mode, apiUrl, workspaceId, apiKey };

}

export function buildAndSignLicense(input: GenerateLicenseInput): SignedLicense {

  input = validateGenerateInput(input);
  const { keyId } = getPublicKeyInfo();
  const now = new Date().toISOString();

  const payload: LicensePayloadV1 = {
    schemaVersion: 1,
    licenseId: newLicenseId(),
    productId: "mooral-business-suite",
    productSchema: "1.0",
    customerName: input.customerName,
    companyName: input.companyName,
    licenseType: input.licenseType,
    issueDate: now,
    expirationDate: input.expirationDate,
    machineFingerprint: input.machineFingerprint,
    // Feature access is derived exclusively by MBS from businessMode. Keep the
    // legacy schema field empty for compatibility with older license readers;
    // the Generator does not accept independent feature declarations.
    features: [],
    activationStatus: "issued",
    keyId,
    algorithm: "ed25519",
    createdAt: now,
    ...(input.supersedesLicenseId ? { supersedesLicenseId: input.supersedesLicenseId } : {}),
    relationship: input.relationship ?? "original",
    activationCode: generateActivationCode(),
    businessMode: input.businessMode,
    ...(input.licensedCloudConfig ? { licensedCloudConfig: input.licensedCloudConfig } : {})
  };

  return signPayload(payload);

}

/** Signs a payload with the Generator key. Existing licenses are re-exported without re-signing. */
export function signPayload(payload: LicensePayloadV1): SignedLicense {

  const message = canonicalBytes(payload);
  const { signatureB64url } = signBytes(message);

  return {
    payload,
    signature: signatureB64url,
    encoding: "base64url-ed25519"
  };

}

/** Customer-facing activation code. The signed license is exported separately. */
export function encodeLicenseKey(signed: SignedLicense): string {
  return signed.payload.activationCode ?? Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
}

export function createActivationPackage(signed: SignedLicense): string {
  if (!signed.payload.activationCode) throw new Error("License has no activation code.");
  return JSON.stringify({
    schemaVersion: 1,
    productId: "mooral-business-suite",
    activationCode: signed.payload.activationCode,
    signedLicense: signed
  }, null, 2);
}


/** Creates the encrypted customer-facing .mbslicense container. */
export function createEncryptedLicensePackage(signed: SignedLicense): string {
  const code = signed.payload.activationCode;
  if (!code) throw new Error("License has no activation code.");
  return createEncryptedLicenseFile(code, signed.payload.machineFingerprint, signed);
}
