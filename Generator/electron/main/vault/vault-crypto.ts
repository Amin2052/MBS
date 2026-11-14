import crypto from "node:crypto";

// scrypt cost parameters — deliberately expensive; this gate only
// runs on interactive login, not in any hot path.
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

export function deriveKeyFromSecret(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 512 * 1024 * 1024
  });
}

export interface AeadEnvelope {
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
}

export function encryptWithSecret(plaintext: Buffer, secret: string): AeadEnvelope {

  const salt = crypto.randomBytes(16);
  const key = deriveKeyFromSecret(secret, salt);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    saltB64: salt.toString("base64"),
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
    ciphertextB64: ciphertext.toString("base64")
  };

}

/** Returns null on wrong secret / tampered envelope instead of throwing. */
export function decryptWithSecret(envelope: AeadEnvelope, secret: string): Buffer | null {

  try {

    const salt = Buffer.from(envelope.saltB64, "base64");
    const key = deriveKeyFromSecret(secret, salt);
    const iv = Buffer.from(envelope.ivB64, "base64");
    const tag = Buffer.from(envelope.tagB64, "base64");
    const ciphertext = Buffer.from(envelope.ciphertextB64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  } catch {

    return null;

  }

}

export function encryptWithRawKey(plaintext: Buffer, key: Buffer): AeadEnvelope {

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    saltB64: "",
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
    ciphertextB64: ciphertext.toString("base64")
  };

}

export function decryptWithRawKey(envelope: AeadEnvelope, key: Buffer): Buffer | null {

  try {

    const iv = Buffer.from(envelope.ivB64, "base64");
    const tag = Buffer.from(envelope.tagB64, "base64");
    const ciphertext = Buffer.from(envelope.ciphertextB64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  } catch {

    return null;

  }

}

/** Formats random bytes as a human-copyable grouped recovery key. */
export function generateRecoveryKey(): string {

  const bytes = crypto.randomBytes(20);
  const b32 = base32Encode(bytes);
  return b32.match(/.{1,5}/g)!.join("-");

}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {

  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buf) {

    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }

  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;

}

export function normalizeRecoveryKeyInput(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z2-7]/g, "");
}
