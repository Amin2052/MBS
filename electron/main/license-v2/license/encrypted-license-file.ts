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

interface EncryptedPlaintextV1 {
  schemaVersion: 1;
  productId: "mooral-business-suite";
  activationCode: string;
  signedLicense: unknown;
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

export function decryptEncryptedLicenseFile(
  fileText: string,
  activationCode: string,
  machineFingerprint: string
): { activationCode: string; signedLicense: unknown } {
  const code = normalizeCode(activationCode);
  if (code.length !== 20) throw new Error("Activation code must contain 20 alphanumeric characters.");
  if (!machineFingerprint || machineFingerprint.length > 500) {
    throw new Error("Invalid machine fingerprint.");
  }

  let envelope: EncryptedLicenseFileV1;
  try {
    envelope = JSON.parse(fileText) as EncryptedLicenseFileV1;
  } catch {
    throw new Error("License file is not a valid MBS license file.");
  }

  if (
    envelope?.schemaVersion !== 1 ||
    envelope.format !== "mbslicense" ||
    envelope.productId !== ENCRYPTED_LICENSE_FILE_PRODUCT ||
    envelope.kdf !== "scrypt" ||
    typeof envelope.saltB64 !== "string" ||
    typeof envelope.ivB64 !== "string" ||
    typeof envelope.tagB64 !== "string" ||
    typeof envelope.ciphertextB64 !== "string"
  ) {
    throw new Error("Invalid MBS license file format.");
  }

  try {
    const salt = Buffer.from(envelope.saltB64, "base64");
    const iv = Buffer.from(envelope.ivB64, "base64");
    const tag = Buffer.from(envelope.tagB64, "base64");
    const ciphertext = Buffer.from(envelope.ciphertextB64, "base64");

    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("Invalid encrypted license file.");
    }

    const key = deriveKey(code, machineFingerprint, salt);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(code, machineFingerprint));
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString("utf8");

    const inner = JSON.parse(plaintext) as EncryptedPlaintextV1;
    const innerCode = normalizeCode(inner?.activationCode ?? "");

    if (
      inner?.schemaVersion !== 1 ||
      inner.productId !== ENCRYPTED_LICENSE_FILE_PRODUCT ||
      innerCode !== code ||
      !inner.signedLicense
    ) {
      throw new Error("License file contents are invalid.");
    }

    return {
      activationCode: innerCode,
      signedLicense: inner.signedLicense
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("License file")) throw error;
    throw new Error("Could not decrypt the license file. Check the activation code and machine.");
  }
}
