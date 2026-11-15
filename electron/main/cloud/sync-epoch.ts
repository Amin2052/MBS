import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// ===================================================================
// Reset epoch (client side)
//
// Mirrors workspaces.reset_epoch in D1 (see
// cloudflare/migrations/0006_workspace_reset_epoch.sql). The sync engine
// sends it on every request as `x-reset-epoch`; the Worker refuses writes
// from a device that still believes it is on an older epoch, which is what
// stops a device that was offline across a cloud reset from pushing the
// pre-reset rows it is still holding back into the (now empty) workspace.
//
// Persisted in userData rather than the database on purpose: the local
// database is exactly what a reset clears, so the epoch has to survive
// that clear in order for the very next sync to present the new value.
// ===================================================================

function epochPath(): string {
  return path.join(app.getPath("userData"), "cloud-reset-epoch.json");
}

export function getStoredResetEpoch(): number {
  try {
    if (!fs.existsSync(epochPath())) return 0;
    const raw = JSON.parse(fs.readFileSync(epochPath(), "utf8")) as { resetEpoch?: unknown };
    const value = Number(raw.resetEpoch);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    // A corrupt/missing epoch file means "never seen a reset" -- the Worker
    // is still the authority on the real value and will tell us on the next
    // request if that is wrong.
    return 0;
  }
}

export function setStoredResetEpoch(resetEpoch: number): void {
  const value = Number(resetEpoch);
  if (!Number.isSafeInteger(value) || value < 0) return;
  fs.mkdirSync(path.dirname(epochPath()), { recursive: true });
  fs.writeFileSync(epochPath(), JSON.stringify({ resetEpoch: value }, null, 2), { mode: 0o600 });
}
