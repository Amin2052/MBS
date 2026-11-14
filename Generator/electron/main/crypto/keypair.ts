import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  encryptWithRawKey,
  decryptWithRawKey,
  type AeadEnvelope
} from "../vault/vault-crypto";
import { getSessionVaultKey } from "../vault/vault-manager";

// ===================================================================
// Signing Key Management
//
// The private key is generated here, immediately wrapped (AES-256-GCM)
// under the vault key, and written to disk only in wrapped form. It
// is decrypted into memory only for the duration of a sign operation
// and is never returned across IPC — only signing *results* cross
// that boundary. Never hardcoded, never logged, never sent anywhere.
// ===================================================================

interface KeypairFile {
  keyId: string;
  algorithm: "ed25519";
  publicKeyBase64: string;
  wrappedPrivateKey: AeadEnvelope;
  createdAt: string;
}

function keypairPath(): string {
  return path.join(app.getPath("userData"), "signing-key.json");
}

export function hasKeypair(): boolean {
  return fs.existsSync(keypairPath());
}

function rawEd25519Keys(): { publicKeyRaw: Buffer; privateKeyRaw: Buffer } {

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;

  // Strip fixed-length ASN.1 prefixes to store/transmit raw 32-byte keys.
  const publicKeyRaw = publicKeyDer.subarray(publicKeyDer.length - 32);
  const privateKeyRaw = privateKeyDer.subarray(privateKeyDer.length - 32);

  return { publicKeyRaw, privateKeyRaw };

}

declare const __MBS_GENERATOR_ENV__: "development" | "production";

function keyIdForToday(): string {
  const now = new Date();
  const prefix = __MBS_GENERATOR_ENV__ === "production" ? "prod" : "dev";
  return `${prefix}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Generates a brand-new keypair and stores it wrapped under the
 * current vault key. Call only once per Generator instance's active
 * key (key rotation = generate a new keypair with a new keyId,
 * keeping the old wrapped key file around for signing verification
 * of already-issued licenses' provenance if ever needed).
 */
export function generateAndStoreKeypair(): { keyId: string; publicKeyBase64: string } {

  if (hasKeypair()) {
    throw new Error("A signing key already exists for this Generator instance.");
  }

  const vaultKey = getSessionVaultKey();
  const { publicKeyRaw, privateKeyRaw } = rawEd25519Keys();

  const wrappedPrivateKey = encryptWithRawKey(privateKeyRaw, vaultKey);

  const file: KeypairFile = {
    keyId: keyIdForToday(),
    algorithm: "ed25519",
    publicKeyBase64: publicKeyRaw.toString("base64"),
    wrappedPrivateKey,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(keypairPath(), JSON.stringify(file), { mode: 0o600 });

  // Zero the raw private key buffer as soon as it's persisted wrapped.
  privateKeyRaw.fill(0);

  return { keyId: file.keyId, publicKeyBase64: file.publicKeyBase64 };

}

export function getPublicKeyInfo(): { keyId: string; publicKeyBase64: string } {
  const file: KeypairFile = JSON.parse(fs.readFileSync(keypairPath(), "utf8"));
  return { keyId: file.keyId, publicKeyBase64: file.publicKeyBase64 };
}

const ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex"
);

/**
 * Signs `payload` (already canonicalized to bytes by the caller) and
 * returns a base64url signature. The unwrapped private key exists
 * only for the duration of this call.
 */
export function signBytes(message: Buffer): { signatureB64url: string; keyId: string } {

  const vaultKey = getSessionVaultKey();
  const file: KeypairFile = JSON.parse(fs.readFileSync(keypairPath(), "utf8"));

  const privateKeyRaw = decryptWithRawKey(file.wrappedPrivateKey, vaultKey);
  if (!privateKeyRaw) {
    throw new Error("Unable to unwrap signing key — vault key mismatch.");
  }

  try {

    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, privateKeyRaw]);
    const keyObject = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });

    const signature = crypto.sign(null, message, keyObject);

    return {
      signatureB64url: signature.toString("base64url"),
      keyId: file.keyId
    };

  } finally {

    privateKeyRaw.fill(0);

  }

}
