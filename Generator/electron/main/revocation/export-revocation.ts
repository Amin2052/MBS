import { canonicalBytes } from "../crypto/canonicalize";
import { signBytes, getPublicKeyInfo } from "../crypto/keypair";
import { listAllLicenses } from "../db/database";

interface RevocationBundle {
  schemaVersion: 1;
  issuedAt: string;
  keyId: string;
  revokedLicenseIds: string[];
}

export function exportRevocationBundle(): string {

  const { keyId } = getPublicKeyInfo();

  const revokedLicenseIds = listAllLicenses()
    .filter((r) => r.status === "revoked")
    .map((r) => r.licenseId);

  const payload: RevocationBundle = {
    schemaVersion: 1,
    issuedAt: new Date().toISOString(),
    keyId,
    revokedLicenseIds
  };

  const { signatureB64url } = signBytes(canonicalBytes(payload));

  return JSON.stringify({
    payload,
    signature: signatureB64url,
    encoding: "base64url-ed25519"
  });

}
