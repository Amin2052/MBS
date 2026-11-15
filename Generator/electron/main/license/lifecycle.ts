import {
  buildAndSignLicense,
  encodeLicenseKey,
  createActivationPackage,
  createEncryptedLicensePackage,
  type GenerateLicenseInput
} from "./generate";
import {
  insertLicense,
  getLicenseById,
  updateLicenseStatus,
  addAuditEntry,
  type LicenseRecordBlob,
  type LicenseRecord
} from "../db/database";
import type { LicensePayloadV1 } from "./schema";
import { resolveBusinessMode } from "./schema";

function normalizeOptionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} is too long.`);
  return normalized;
}

function isPrimaryKeyCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

/** license_id is the SQLite primary key (see database.ts), so a
 * collision throws rather than silently overwriting an existing license
 * — a real requirement, not just a nicety, since license_id doubles as
 * the identity checked by revocation and by MBS's own display. A random
 * 8-hex-char suffix makes a collision astronomically unlikely, but this
 * still retries with a freshly generated (and re-signed) license rather
 * than surfacing a raw SQLite error to the operator. */
const MAX_LICENSE_ID_COLLISION_RETRIES = 5;

export function generateNewLicense(input: GenerateLicenseInput & { notes?: string }) {

  const notes = normalizeOptionalText(input.notes, "Notes", 2000);

  for (let attempt = 0; attempt <= MAX_LICENSE_ID_COLLISION_RETRIES; attempt++) {

    const signed = buildAndSignLicense(input);

    // Store exactly what was signed. buildAndSignLicense() trims the input
    // into its own payload, so using the raw input here used to save names
    // and machine IDs that differ from the signed license by whitespace.
    const blob: LicenseRecordBlob = {
      customerName: signed.payload.customerName,
      companyName: signed.payload.companyName,
      machineFingerprint: signed.payload.machineFingerprint,
      notes,
      signedLicense: signed
    };

    try {
      insertLicense(
        signed.payload.licenseId,
        "issued",
        signed.payload.licenseType,
        signed.payload.relationship ?? "original",
        signed.payload.supersedesLicenseId ?? null,
        blob
      );
    } catch (error) {
      if (isPrimaryKeyCollision(error) && attempt < MAX_LICENSE_ID_COLLISION_RETRIES) {
        continue; // regenerate a fresh licenseId (and re-sign) rather than overwrite or fail
      }
      throw error;
    }

    return {
      licenseKey: encodeLicenseKey(signed),
      activationCode: signed.payload.activationCode!,
      activationPackage: createActivationPackage(signed),
      licenseFile: createEncryptedLicensePackage(signed),
      signed
    };

  }

  // Unreachable: the loop above always either returns or throws.
  throw new Error("Could not generate a unique license ID.");

}

/** Retrieves and re-signs the SAME licenseId/payload — the "lost activation" flow. */
export function reExportOriginal(licenseId: string) {

  const record = getLicenseById(licenseId);
  if (!record) throw new Error("License not found.");

  const original = record.data.signedLicense;

  addAuditEntry(licenseId, "reexported");

  return {
    licenseKey: encodeLicenseKey(original),
    activationCode: original.payload.activationCode ?? null,
    activationPackage: original.payload.activationCode ? createActivationPackage(original) : null,
    licenseFile: original.payload.activationCode ? createEncryptedLicensePackage(original) : null,
    signed: original
  };

}

export function createReplacement(
  originalLicenseId: string,
  overrides: Partial<Pick<LicensePayloadV1, "machineFingerprint" | "expirationDate">>,
  notes?: string
) {

  const original = getLicenseById(originalLicenseId);
  if (!original) throw new Error("Original license not found.");

  const input: GenerateLicenseInput = {
    customerName: original.data.customerName,
    companyName: original.data.companyName,
    licenseType: original.data.signedLicense.payload.licenseType,
    expirationDate:
      overrides.expirationDate !== undefined
        ? overrides.expirationDate
        : original.data.signedLicense.payload.expirationDate,
    machineFingerprint: overrides.machineFingerprint ?? original.data.machineFingerprint,
    supersedesLicenseId: originalLicenseId,
    relationship: "replacement",
    businessMode: resolveBusinessMode(original.data.signedLicense.payload),
    licensedCloudConfig: original.data.signedLicense.payload.licensedCloudConfig
  };

  const result = generateNewLicense({ ...input, notes });

  addAuditEntry(originalLicenseId, "replaced", `by ${result.signed.payload.licenseId}`);

  return result;

}

export function renewLicense(originalLicenseId: string, newExpirationDate: string | null, notes?: string) {

  const original = getLicenseById(originalLicenseId);
  if (!original) throw new Error("Original license not found.");

  const input: GenerateLicenseInput = {
    customerName: original.data.customerName,
    companyName: original.data.companyName,
    licenseType: original.data.signedLicense.payload.licenseType,
    expirationDate: newExpirationDate,
    machineFingerprint: original.data.machineFingerprint,
    supersedesLicenseId: originalLicenseId,
    relationship: "renewal",
    businessMode: resolveBusinessMode(original.data.signedLicense.payload),
    // A renewal continues the same commercial terms: without this, renewing
    // a cloud-entitled license silently issued one with no cloud access.
    licensedCloudConfig: original.data.signedLicense.payload.licensedCloudConfig
  };

  const result = generateNewLicense({ ...input, notes });

  addAuditEntry(originalLicenseId, "renewed", `by ${result.signed.payload.licenseId}`);

  return result;

}

export function revokeLicense(licenseId: string, reason?: string): LicenseRecord {
  const normalizedId = typeof licenseId === "string" ? licenseId.trim() : "";
  if (!normalizedId) throw new Error("License ID is required.");

  const record = getLicenseById(normalizedId);
  if (!record) throw new Error("License not found.");
  if (record.status === "revoked") throw new Error("License is already revoked.");

  const normalizedReason = normalizeOptionalText(reason, "Revocation reason", 500);
  updateLicenseStatus(normalizedId, "revoked", "revoked", normalizedReason || undefined);

  // Read the record back from SQLite so callers receive the authoritative
  // persisted lifecycle state, not a stale renderer copy.
  const updated = getLicenseById(normalizedId);
  if (!updated || updated.status !== "revoked") {
    throw new Error("License revocation was not persisted.");
  }

  return updated;
}
