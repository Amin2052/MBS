import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { verifyEd25519 } from "../crypto/verify";
import { findTrustedKey } from "../keys/trusted-keys";

// ===================================================================
// Offline Revocation
//
// MBS never phones home, so revocation cannot propagate instantly.
// Instead: the Generator can export a signed "revocation bundle"
// (a list of revoked license IDs, signed the same way a license is).
// The customer/support process can deliver that file to a machine
// (email attachment, USB, etc.) and the user imports it from
// Settings → License. MBS trusts a bundle if its signature verifies
// against a trusted key, and only ever *adds* to its local revoked-ID
// set (a newer bundle can supersede an older one via `issuedAt`, but
// import never silently *removes* a revocation).
//
// This is deliberately NOT presented to the user as real-time
// revocation — it is best-effort, offline, pull-based revocation.
// ===================================================================

export interface RevocationBundle {
  schemaVersion: 1;
  issuedAt: string;
  keyId: string;
  revokedLicenseIds: string[];
}

export interface SignedRevocationBundle {
  payload: RevocationBundle;
  signature: string;
  encoding: "base64url-ed25519";
}

function revocationStorePath(): string {
  return path.join(app.getPath("userData"), "license-v2-revocations.json");
}

interface RevocationStore {
  lastImportedAt: string | null;
  revokedLicenseIds: string[];
}

function loadStore(): RevocationStore {

  try {
    const raw = fs.readFileSync(revocationStorePath(), "utf8");
    const parsed = JSON.parse(raw) as RevocationStore;
    if (Array.isArray(parsed.revokedLicenseIds)) return parsed;
  } catch {
    // no store yet, or unreadable — start fresh
  }

  return { lastImportedAt: null, revokedLicenseIds: [] };

}

function saveStore(store: RevocationStore): void {
  fs.writeFileSync(revocationStorePath(), JSON.stringify(store), {
    mode: 0o600
  });
}

export function isRevoked(licenseId: string): boolean {
  const store = loadStore();
  return store.revokedLicenseIds.includes(licenseId);
}

/**
 * Verifies and merges a signed revocation bundle into local storage.
 * Returns whether it was accepted, and why if not.
 */
export function importRevocationBundle(
  bundleJson: string
): { accepted: boolean; reason?: string; addedCount?: number } {

  let parsed: SignedRevocationBundle;

  try {
    parsed = JSON.parse(bundleJson);
  } catch {
    return { accepted: false, reason: "File is not valid JSON." };
  }

  if (
    !parsed ||
    parsed.encoding !== "base64url-ed25519" ||
    typeof parsed.signature !== "string" ||
    !parsed.payload ||
    parsed.payload.schemaVersion !== 1 ||
    !Array.isArray(parsed.payload.revokedLicenseIds)
  ) {
    return { accepted: false, reason: "File is not a valid revocation bundle." };
  }

  // A revocation bundle must be held to the exact same production/dev
  // key-trust boundary as a license itself -- a packaged build must
  // never accept a revocation bundle "signed" with the dev key either.
  const key = findTrustedKey(parsed.payload.keyId, { allowDevelopmentKeys: !app.isPackaged });

  if (!key) {
    return { accepted: false, reason: "Bundle was signed with an untrusted key." };
  }

  const validSignature = verifyEd25519(
    parsed.payload,
    parsed.signature,
    key.publicKeyBase64
  );

  if (!validSignature) {
    return { accepted: false, reason: "Bundle signature is invalid." };
  }

  const store = loadStore();
  const before = new Set(store.revokedLicenseIds);
  const merged = new Set(store.revokedLicenseIds);

  for (const id of parsed.payload.revokedLicenseIds) {
    if (typeof id === "string") merged.add(id);
  }

  store.revokedLicenseIds = Array.from(merged);
  store.lastImportedAt = new Date().toISOString();
  saveStore(store);

  return { accepted: true, addedCount: merged.size - before.size };

}

export function getRevocationStatus(): { lastImportedAt: string | null; count: number } {
  const store = loadStore();
  return { lastImportedAt: store.lastImportedAt, count: store.revokedLicenseIds.length };
}
