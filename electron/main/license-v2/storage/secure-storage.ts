import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { getMachineFingerprint } from "../crypto/machine-fingerprint";

// ===================================================================
// Secure Local License Storage (MBS side)
//
// The real security boundary for a license is its signature — this
// storage layer exists to make casual copying/tampering of the
// stored activation record inconvenient, not to substitute for
// signature verification (which always re-runs on every status
// check; this file's contents are never trusted blindly).
//
// The activation blob is encrypted with AES-256-GCM using a key
// derived (scrypt) from this specific machine's fingerprint plus a
// per-install random value stored alongside it. This ties the stored
// file to this machine and this install, so copying just the file to
// another machine will not decrypt.
// ===================================================================

interface StoredEnvelope {
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
}

function storeDir(): string {
  return app.getPath("userData");
}

function envelopePath(): string {
  return path.join(storeDir(), "license-v2.activation");
}

function installSecretPath(): string {
  return path.join(storeDir(), ".license-v2-install-secret");
}

function getOrCreateInstallSecret(): Buffer {

  try {
    return fs.readFileSync(installSecretPath());
  } catch {
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(installSecretPath(), secret, { mode: 0o600 });
    return secret;
  }

}

function deriveKey(salt: Buffer): Buffer {

  const installSecret = getOrCreateInstallSecret();
  const material = Buffer.concat([
    Buffer.from(getMachineFingerprint(), "utf8"),
    installSecret
  ]);

  // maxmem must be explicit: Node's default maxmem (32 MiB) is exactly
  // equal to the documented "128*N*r" estimate for N=2**15, r=8, but
  // OpenSSL's actual internal accounting for scrypt needs slightly
  // more than that estimate, so relying on the default fails with
  // "MEMORY_LIMIT_EXCEEDED" on this exact boundary case. 256 MiB
  // matches the margin already used in encrypted-license-file.ts.
  return crypto.scryptSync(material, salt, 32, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024
  });

}

export function saveActivation(signedLicenseJson: string): void {

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(signedLicenseJson, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  const envelope: StoredEnvelope = {
    saltB64: salt.toString("base64"),
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
    ciphertextB64: ciphertext.toString("base64")
  };

  fs.writeFileSync(envelopePath(), JSON.stringify(envelope), { mode: 0o600 });

}

/**
 * Returns the decrypted, still-unverified JSON string, or null if
 * nothing is stored or decryption fails (tampered/copied file). The
 * caller MUST still run this through verify-license.ts before trusting
 * it — decrypting successfully only proves it's the same file on the
 * same machine, not that it's a genuine, unexpired, correctly-bound
 * license.
 */
export function loadActivation(): string | null {

  let raw: string;

  try {
    raw = fs.readFileSync(envelopePath(), "utf8");
  } catch {
    return null;
  }

  let envelope: StoredEnvelope;

  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }

  try {

    const salt = Buffer.from(envelope.saltB64, "base64");
    const iv = Buffer.from(envelope.ivB64, "base64");
    const tag = Buffer.from(envelope.tagB64, "base64");
    const ciphertext = Buffer.from(envelope.ciphertextB64, "base64");

    const key = deriveKey(salt);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return plaintext.toString("utf8");

  } catch {

    // Tampered ciphertext/tag, or file copied from another machine
    // (wrong derived key) — auth tag check fails and we land here.
    return null;

  }

}

export function clearActivation(): void {
  try {
    fs.unlinkSync(envelopePath());
  } catch {
    // nothing to remove
  }
}
