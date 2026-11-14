import crypto from "node:crypto";

export const ENCRYPTED_LICENSE_FILE_SCHEMA = 1;
export const ENCRYPTED_LICENSE_FILE_PRODUCT = "mooral-business-suite";
const KDF_N = 2 ** 15;
const KDF_R = 8;
const KDF_P = 1;
const KEY_LEN = 32;

export interface EncryptedLicenseFileV1 {
  schemaVersion: 1;
  format: "mbslicense";
  productId: "mooral-business-suite";
  kdf: "scrypt";
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function deriveKey(activationCode: string, machineFingerprint: string, salt: Buffer): Buffer {
  const material = Buffer.from(
    `MBS-LICENSE-FILE-V1\0${normalizeCode(activationCode)}\0${machineFingerprint}`,
    "utf8"
  );
  return crypto.scryptSync(material, salt, KEY_LEN, {
    N: KDF_N,
    r: KDF_R,
    p: KDF_P,
    maxmem: 256 * 1024 * 1024
  });
}

function aad(activationCode: string, machineFingerprint: string): Buffer {
  return Buffer.from(
    `MBS-LICENSE-FILE-V1|${normalizeCode(activationCode)}|${machineFingerprint}`,
    "utf8"
  );
}

/**
 * Customer license container.
 *
 * The complete signed license is encrypted with AES-256-GCM. The key is
 * derived from the 20-character activation code and the target machine
 * fingerprint. The Ed25519 signature remains inside the encrypted
 * plaintext and is still the authoritative authenticity check.
 */
export function createEncryptedLicenseFile(
  activationCode: string,
  machineFingerprint: string,
  signedLicense: unknown
): string {
  const code = normalizeCode(activationCode);
  if (code.length !== 20) throw new Error("Invalid activation code.");
  if (!machineFingerprint || machineFingerprint.length > 500) {
    throw new Error("Invalid machine fingerprint.");
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(code, machineFingerprint, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(code, machineFingerprint));

  const plaintext = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      productId: ENCRYPTED_LICENSE_FILE_PRODUCT,
      activationCode: code,
      signedLicense
    }),
    "utf8"
  );

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedLicenseFileV1 = {
    schemaVersion: 1,
    format: "mbslicense",
    productId: ENCRYPTED_LICENSE_FILE_PRODUCT,
    kdf: "scrypt",
    saltB64: salt.toString("base64"),
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
    ciphertextB64: ciphertext.toString("base64")
  };

  return JSON.stringify(envelope);
}
