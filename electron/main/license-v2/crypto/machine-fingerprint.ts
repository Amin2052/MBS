import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// ===================================================================
// Machine Fingerprint
//
// Produces a stable identifier for the current machine, derived from
// hardware/OS characteristics rather than an app-generated random
// value stored on disk. A stored-random-value approach can be reset
// by deleting a file; deriving from machine characteristics cannot be
// reset that way, which is the property machine binding needs.
//
// This is a defense-in-depth measure, not a claim of perfect hardware
// identification. It is combined with signature + expiry checks, not
// relied on alone.
//
// AUDIT FIX #3: previously included `hostname` and `homedir`, both of
// which a legitimate customer can change for entirely mundane reasons
// (renaming their PC, changing their OS username) with no intent to
// move the install to different hardware -- which used to flip their
// license to "wrong_machine" and generate an avoidable support case.
// Replaced with a per-OS stable hardware/installation identifier
// (Windows MachineGuid, Linux /etc/machine-id, macOS
// IOPlatformUUID) that does not change on rename, with the previous
// platform/arch/cpuModel/totalmem fields kept as a fallback if that
// lookup fails for any reason. totalmem is bucketed to the nearest
// GiB so minor reporting differences between boots don't matter.
// ===================================================================

function safeCpuModel(): string {
  try {
    const cpus = os.cpus();
    return cpus && cpus.length > 0 ? cpus[0].model : "unknown-cpu";
  } catch {
    return "unknown-cpu";
  }
}

function roundedTotalMemGiB(): string {
  try {
    return String(Math.round(os.totalmem() / (1024 ** 3)));
  } catch {
    return "unknown-mem";
  }
}

/**
 * Best-effort, per-OS stable hardware/installation identifier that
 * does not change when the user renames their computer or their OS
 * account. Returns null (never throws) if the lookup isn't available,
 * in which case getMachineFingerprint() falls back to the platform/
 * arch/cpuModel/totalmem combination alone -- worse for tolerating a
 * rename, but never worse than the pre-fix behavior.
 */
function stableHardwareId(): string | null {

  try {

    const platform = os.platform();

    if (platform === "linux") {
      for (const candidate of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        try {
          const id = fs.readFileSync(candidate, "utf8").trim();
          if (id) return `linux:${id}`;
        } catch {
          // try next candidate
        }
      }
      return null;
    }

    if (platform === "win32") {
      const out = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { timeout: 3000, windowsHide: true }
      ).toString("utf8");
      const match = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      const guid = match?.[1]?.trim();
      return guid ? `win32:${guid}` : null;
    }

    if (platform === "darwin") {
      const out = execFileSync(
        "ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        { timeout: 3000 }
      ).toString("utf8");
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      const uuid = match?.[1]?.trim();
      return uuid ? `darwin:${uuid}` : null;
    }

    return null;

  } catch {
    // Command unavailable, sandboxed, timed out, or unparsable output
    // -- fall back to the OS-characteristics-only fingerprint.
    return null;
  }

}

/**
 * Returns the raw ingredients used to build the fingerprint. Exposed
 * separately so the Settings UI can show *why* two fingerprints
 * differ if support ever needs to debug an activation issue, without
 * exposing anything sensitive.
 */
export function machineFingerprintInputs(): Record<string, string> {

  const hardwareId = stableHardwareId();

  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: safeCpuModel(),
    totalmemGiB: roundedTotalMemGiB(),
    ...(hardwareId ? { hardwareId } : {})
  };

}

/**
 * Deterministic, stable machine identifier: sha256 of the sorted
 * key:value pairs above, hex-encoded and truncated to a
 * human-copyable 32-character identifier grouped for readability.
 */
export function getMachineFingerprint(): string {

  const inputs = machineFingerprintInputs();

  const canonical = Object.keys(inputs)
    .sort()
    .map((k) => `${k}=${inputs[k]}`)
    .join("|");

  const hash = crypto.createHash("sha256").update(canonical).digest("hex");

  const short = hash.slice(0, 32).toUpperCase();

  return short.match(/.{1,4}/g)!.join("-");

}
