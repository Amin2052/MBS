import {
  isStructurallyValidSignedLicense,
  type LicenseValidationResult,
  type SignedLicense
} from "./schema";

import { verifyEd25519 } from "../crypto/verify";
import { findTrustedKey } from "../keys/trusted-keys";
import { isRevoked } from "./revocation";

/**
 * Full offline verification pipeline. Every check is independent and
 * order matters only for producing a useful `status` — a caller must
 * never treat a partial pass (e.g. "signature ok") as sufficient on
 * its own. This is the single choke point every activation/status
 * check in MBS must go through; nothing upstream of this should ever
 * short-circuit to "licensed = true".
 */
export function verifySignedLicense(
  raw: unknown,
  currentMachineFingerprint: string,
  options: { allowDevelopmentKeys: boolean } = { allowDevelopmentKeys: false }
): LicenseValidationResult {

  if (!isStructurallyValidSignedLicense(raw)) {
    return { valid: false, status: "invalid_format", reason: "Malformed license data." };
  }

  const signed = raw as SignedLicense;
  const { payload } = signed;

  const key = findTrustedKey(payload.keyId, options);

  if (!key) {
    return {
      valid: false,
      status: "unknown_key",
      payload,
      reason: `License was signed with an untrusted key (${payload.keyId}).`
    };
  }

  const signatureValid = verifyEd25519(payload, signed.signature, key.publicKeyBase64);

  if (!signatureValid) {
    return {
      valid: false,
      status: "invalid_signature",
      payload,
      reason: "License signature does not match its contents."
    };
  }

  if (payload.productId !== "mooral-business-suite") {
    return { valid: false, status: "wrong_product", payload, reason: "License is not for this product." };
  }

  if (payload.machineFingerprint !== currentMachineFingerprint) {
    return {
      valid: false,
      status: "wrong_machine",
      payload,
      reason: "License is bound to a different machine."
    };
  }

  if (payload.expirationDate) {
    const expiry = Date.parse(payload.expirationDate);
    if (isNaN(expiry) || Date.now() > expiry) {
      return { valid: false, status: "expired", payload, reason: "License has expired." };
    }
  }

  if (payload.activationStatus === "revoked" || isRevoked(payload.licenseId)) {
    return { valid: false, status: "revoked", payload, reason: "License has been revoked." };
  }

  return { valid: true, status: "valid", payload };

}
