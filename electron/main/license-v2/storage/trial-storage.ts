import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { getMachineFingerprint } from "../crypto/machine-fingerprint";

export interface TrialProfile {
  ownerFullName: string;
  companyName: string;
  email: string;
  phone: string;
  machineId: string;
  requestId: string;
  savedAt: string;
}

interface TrialRecord {
  schemaVersion: 1;
  trialStartedAt: string;
  trialExpiresAt: string;
  profile: TrialProfile;
}

interface StoredEnvelope {
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
}

const recordPath = () => path.join(app.getPath("userData"), "license-v2.trial");
const secretPath = () => path.join(app.getPath("userData"), ".license-v2-trial-secret");

function installSecret(): Buffer {
  try { return fs.readFileSync(secretPath()); }
  catch {
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(secretPath(), secret, { mode: 0o600 });
    return secret;
  }
}

function deriveKey(salt: Buffer): Buffer {
  // See secure-storage.ts deriveKey for why maxmem must be explicit
  // here: Node's default (32 MiB) sits exactly on the boundary for
  // N=2**15, r=8 and fails under real OpenSSL memory accounting.
  return crypto.scryptSync(
    Buffer.concat([Buffer.from(getMachineFingerprint(), "utf8"), installSecret()]),
    salt,
    32,
    { N: 2 ** 15, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
  );
}

function encrypt(record: TrialRecord): void {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(salt), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  const envelope: StoredEnvelope = {
    saltB64: salt.toString("base64"),
    ivB64: iv.toString("base64"),
    tagB64: cipher.getAuthTag().toString("base64"),
    ciphertextB64: ciphertext.toString("base64")
  };
  fs.writeFileSync(recordPath(), JSON.stringify(envelope), { mode: 0o600 });
}

function decrypt(): TrialRecord | null {
  try {
    const e = JSON.parse(fs.readFileSync(recordPath(), "utf8")) as StoredEnvelope;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveKey(Buffer.from(e.saltB64, "base64")),
      Buffer.from(e.ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(e.tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(e.ciphertextB64, "base64")),
      decipher.final()
    ]).toString("utf8");
    const record = JSON.parse(plaintext) as TrialRecord;
    if (record.schemaVersion !== 1 || !record.profile) return null;
    return record;
  } catch {
    return null;
  }
}

// ===================================================================
// Trial anchor (audit fix #2)
//
// The primary trial record above lives entirely under app.getPath
// ("userData") and is keyed by a randomly-generated install secret
// stored alongside it. Deleting that one folder (an "uninstall and
// keep nothing" or "clear app data" action many users can do without
// any special tooling) therefore reset the 7-day trial indefinitely.
//
// This anchor is a second, minimal record (just the trial start/end
// timestamps, no profile/PII) stored OUTSIDE userData, at a path and
// under a key that are both deterministically derived from the
// machine fingerprint alone -- nothing random is stored anywhere for
// this to depend on, so it can always be recomputed and checked even
// after every userData file has been deleted. It does not attempt to
// survive a full OS reinstall or a deliberate, informed attacker who
// goes looking for it; it exists to stop the trivial "delete the app
// data folder and relaunch" reset, not to be unbeatable DRM.
// ===================================================================

interface TrialAnchor {
  trialStartedAt: string;
  trialExpiresAt: string;
}

function anchorDir(): string {
  // Deliberately NOT under app.getPath("userData") or anything named
  // after the product -- see comment above.
  return path.join(os.homedir(), ".mbs_sys_cache");
}

function anchorKeyMaterial(): string {
  return `MBS-TRIAL-ANCHOR-V1|${getMachineFingerprint()}`;
}

function anchorFileName(): string {
  const hash = crypto.createHash("sha256").update(anchorKeyMaterial()).digest("hex");
  return `${hash.slice(0, 32)}.dat`;
}

function anchorPath(): string {
  return path.join(anchorDir(), anchorFileName());
}

function anchorKey(): Buffer {
  // Fully deterministic (no stored salt/secret) so it survives the
  // primary store, its install secret, and this anchor file all being
  // deleted -- the key can always be recomputed from the machine
  // fingerprint alone.
  return crypto.scryptSync(anchorKeyMaterial(), "mbs-trial-anchor-fixed-salt-v1", 32, {
    N: 2 ** 14,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024
  });
}

function writeAnchor(record: TrialAnchor): void {
  try {
    fs.mkdirSync(anchorDir(), { recursive: true });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", anchorKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
    const envelope: StoredEnvelope = {
      saltB64: "",
      ivB64: iv.toString("base64"),
      tagB64: cipher.getAuthTag().toString("base64"),
      ciphertextB64: ciphertext.toString("base64")
    };
    fs.writeFileSync(anchorPath(), JSON.stringify(envelope));
  } catch {
    // Best-effort only -- a read-only/unwritable home directory must
    // never prevent a legitimate trial from starting.
  }
}

function readAnchor(): TrialAnchor | null {
  try {
    const e = JSON.parse(fs.readFileSync(anchorPath(), "utf8")) as StoredEnvelope;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      anchorKey(),
      Buffer.from(e.ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(e.tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(e.ciphertextB64, "base64")),
      decipher.final()
    ]).toString("utf8");
    const record = JSON.parse(plaintext) as TrialAnchor;
    if (typeof record.trialStartedAt !== "string" || typeof record.trialExpiresAt !== "string") return null;
    return record;
  } catch {
    return null;
  }
}

export function getTrialProfile(): TrialProfile | null {
  return decrypt()?.profile ?? null;
}

export function saveTrialProfile(input: Omit<TrialProfile, "machineId" | "requestId" | "savedAt"> & {
  machineId?: string;
  requestId?: string;
}): TrialProfile {
  const machineId = getMachineFingerprint();
  const existing = decrypt();
  const profile: TrialProfile = {
    ownerFullName: input.ownerFullName.trim(),
    companyName: input.companyName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    machineId,
    requestId: input.requestId?.trim() || existing?.profile.requestId ||
      `REQ-${new Date().getFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
    savedAt: new Date().toISOString()
  };

  if (existing) {
    encrypt({ ...existing, profile });
  } else {
    const started = new Date();
    const expires = new Date(started.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Saving profile alone must not silently start a trial.
    encrypt({
      schemaVersion: 1,
      trialStartedAt: "",
      trialExpiresAt: "",
      profile
    });
  }
  return profile;
}

export function startTrial(profileInput: Omit<TrialProfile, "machineId" | "requestId" | "savedAt">): {
  success: true; expiresAt: string; profile: TrialProfile;
} | { success: false; reason: string } {
  const existing = decrypt();
  const machineId = getMachineFingerprint();

  if (existing?.trialStartedAt) {
    const expires = Date.parse(existing.trialExpiresAt);
    if (Number.isFinite(expires) && Date.now() < expires) {
      return { success: true, expiresAt: existing.trialExpiresAt, profile: existing.profile };
    }
    return { success: false, reason: "The 7-day trial has already been used on this machine." };
  }

  // The primary record shows no trial -- but before treating that as
  // "never used", check the anchor (audit fix #2). If it remembers a
  // trial for this exact machine fingerprint, the primary store was
  // reset (deleted/corrupted) rather than genuinely never having run
  // one, and this must not grant a fresh trial.
  const anchor = readAnchor();
  if (anchor?.trialStartedAt) {
    return { success: false, reason: "The 7-day trial has already been used on this machine." };
  }

  const profile = saveTrialProfile({ ...profileInput, machineId });
  const started = new Date();
  const expires = new Date(started.getTime() + 7 * 24 * 60 * 60 * 1000);
  encrypt({
    schemaVersion: 1,
    trialStartedAt: started.toISOString(),
    trialExpiresAt: expires.toISOString(),
    profile
  });
  writeAnchor({ trialStartedAt: started.toISOString(), trialExpiresAt: expires.toISOString() });
  return { success: true, expiresAt: expires.toISOString(), profile };
}

export function getTrialStatus(): {
  active: boolean; used: boolean; expiresAt?: string; profile?: TrialProfile;
} {
  const record = decrypt();

  if (!record || !record.trialStartedAt) {
    // Primary store has no trial recorded -- fall back to the anchor
    // (audit fix #2) before concluding the trial was genuinely never
    // used, since the primary store is trivially deletable.
    const anchor = readAnchor();
    if (anchor?.trialStartedAt) {
      const expires = Date.parse(anchor.trialExpiresAt);
      return {
        active: Number.isFinite(expires) && Date.now() < expires,
        used: true,
        expiresAt: anchor.trialExpiresAt,
        profile: record?.profile
      };
    }
    return { active: false, used: false, profile: record?.profile };
  }

  const expires = Date.parse(record.trialExpiresAt);
  return {
    active: Number.isFinite(expires) && Date.now() < expires,
    used: true,
    expiresAt: record.trialExpiresAt,
    profile: record.profile
  };
}
