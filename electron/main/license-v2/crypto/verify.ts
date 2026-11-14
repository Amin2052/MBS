import crypto from "node:crypto";

// ===================================================================
// License Verification Crypto (MBS side — verify only)
//
// This file is intentionally the *only* cryptographic capability MBS
// has with respect to licenses: verifying an Ed25519 signature over a
// canonical byte representation of a license payload. There is no
// signing function anywhere in the MBS codebase. Ed25519 is provided
// by Node's built-in `crypto` module (OpenSSL under the hood) — this
// is an established, audited primitive, not custom cryptography.
// ===================================================================

/**
 * Canonicalize a JSON-serializable object into a deterministic byte
 * sequence so that signing (Generator) and verification (MBS) always
 * hash/sign the exact same bytes for the exact same logical payload,
 * regardless of key insertion order. Recursively sorts object keys.
 * This is the ONLY thing that gets signed — never sign a raw
 * JSON.stringify() of an object with unspecified key order.
 */
export function canonicalize(value: unknown): string {

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();

  const entries = keys.map((key) => {
    const v = (value as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalize(v)}`;
  });

  return `{${entries.join(",")}}`;

}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), "utf8");
}

/**
 * Verify an Ed25519 signature over `payload` using the raw public key
 * bytes (32 bytes) for `publicKeyBase64`. Returns false on any
 * malformed input rather than throwing, so callers can treat
 * verification as a single boolean gate.
 */
export function verifyEd25519(
  payload: unknown,
  signatureBase64url: string,
  publicKeyBase64: string
): boolean {

  try {

    const publicKeyDer = rawEd25519PublicKeyToSpki(
      Buffer.from(publicKeyBase64, "base64")
    );

    const keyObject = crypto.createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki"
    });

    const signature = Buffer.from(
      base64urlToBase64(signatureBase64url),
      "base64"
    );

    const message = canonicalBytes(payload);

    return crypto.verify(null, message, keyObject, signature);

  } catch {

    return false;

  }

}

function base64urlToBase64(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return padded + pad;
}

// Node's crypto.createPublicKey requires an SPKI-wrapped DER key for
// Ed25519, not the raw 32-byte public key. This wraps raw key bytes
// in the fixed, standard Ed25519 SPKI DER prefix (RFC 8410).
const ED25519_SPKI_PREFIX = Buffer.from(
  "302a300506032b6570032100",
  "hex"
);

function rawEd25519PublicKeyToSpki(rawKey: Buffer): Buffer {

  if (rawKey.length !== 32) {
    throw new Error("Invalid Ed25519 public key length");
  }

  return Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);

}
