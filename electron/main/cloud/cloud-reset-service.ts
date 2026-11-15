import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { getCloudConfig } from "./cloud-config-service";
import { getCloudWorkspaceInfo, resetCloudWorkspace } from "./cloud-client";
import { getStoredResetEpoch, setStoredResetEpoch } from "./sync-epoch";
import {
  RESET_BUSINESS_TABLES, countLocalBusinessRows, clearLocalBusinessData,
  clearAllSyncBookkeeping, performFactoryReset
} from "../reset-service";
import { createBackup } from "../backup-service";

// ===================================================================
// Reset orchestration
//
// Three operations, deliberately NOT merged into one flag (the old UI had
// only ERP Reset and Factory Reset, and neither touched the cloud at all):
//
//   local    -- this device only. Existing performErpReset(): business
//               records here are deleted, logins/permissions/settings/
//               license stay. On a cloud-connected installation the cloud
//               copy still exists, so the next sync pulls it back down.
//               The UI says so explicitly; that is the documented meaning
//               of "reset this device", not a bug.
//
//   cloud    -- the central business data for the licensed workspace is
//               deleted, the workspace reset epoch is bumped, and THIS
//               device's copy is cleared so it does not sit permanently
//               out of sync. Logins, permission profiles, employee
//               records, company settings and licensing are preserved on
//               both sides (see BUSINESS_RESET_TABLES in the Worker).
//               Other devices discover the new epoch on their next write,
//               drop their pre-reset copies, and re-baseline.
//
//   complete -- cloud reset first (so nothing is deleted locally if the
//               central operation fails), then the existing factory reset
//               (all business data, all accounts, settings back to
//               first-run). The license and the installation identity are
//               untouched, exactly as the existing factory reset already
//               guarantees.
//
// Every path creates a real SQLite backup BEFORE it deletes anything. The
// backup's location is returned so the UI can tell the owner where it is.
// ===================================================================

const OWNER_ONLY_NOTE = "Only the Owner can reset business data.";

export interface ResetPreview {
  cloudEnabled: boolean;
  workspaceId: string;
  resetEpoch: number;
  cloudReachable: boolean;
  cloudError?: string;
  localCounts: Record<string, number>;
  tables: string[];
  note: string;
}

export interface ResetOutcome {
  success: boolean;
  error?: string;
  backupPath?: string;
  resetEpoch?: number;
  deleted?: Record<string, number>;
}

export async function getResetPreview(): Promise<ResetPreview> {
  const config = getCloudConfig();
  const cloudEnabled = Boolean(config.enabled && config.apiUrl && config.workspaceId && config.apiKey);
  const preview: ResetPreview = {
    cloudEnabled,
    workspaceId: config.workspaceId || "",
    resetEpoch: getStoredResetEpoch(),
    cloudReachable: false,
    localCounts: countLocalBusinessRows(),
    tables: [...RESET_BUSINESS_TABLES],
    note: OWNER_ONLY_NOTE
  };
  if (!cloudEnabled) return preview;
  // Best-effort: an offline owner can still reset locally, and must still be
  // told that the central copy could not be checked, rather than being shown
  // a confident "0 rows in the cloud".
  try {
    const info = await getCloudWorkspaceInfo();
    preview.cloudReachable = true;
    preview.resetEpoch = info.resetEpoch;
    setStoredResetEpoch(info.resetEpoch);
  } catch (error) {
    preview.cloudError = error instanceof Error ? error.message : String(error);
  }
  return preview;
}

/** Creates the safety backup every reset path requires before it deletes
 *  anything, in userData/backups (not a user-chosen path: this must not be
 *  cancellable, because "cancel" would then mean "reset without a backup"). */
async function backupBeforeReset(label: string): Promise<string> {
  const directory = path.join(app.getPath("userData"), "backups");
  await fs.mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(directory, `pre-${label}-${stamp}.mbsbackup`);
  const result = await createBackup(destination);
  if (!result.success) throw new Error(result.error || "The safety backup could not be created, so nothing was reset.");
  return result.filePath || destination;
}

/** Central business-data reset for the licensed workspace, plus clearing
 *  this device's copy of the same data. */
export async function performCloudBusinessReset(input: { confirmWorkspace: string }): Promise<ResetOutcome> {
  const config = getCloudConfig();
  if (!config.enabled || !config.apiUrl || !config.workspaceId || !config.apiKey) {
    return { success: false, error: "Cloud sync is not configured on this installation, so there is no central data to reset." };
  }
  if (String(input.confirmWorkspace).trim() !== config.workspaceId) {
    return { success: false, error: "The confirmation does not exactly match the workspace id." };
  }

  let backupPath: string;
  try {
    backupPath = await backupBeforeReset("cloud-reset");
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  let resetEpoch: number;
  let deleted: Record<string, number>;
  try {
    // Central first: if this fails, the local database is untouched and the
    // owner can retry. Deleting locally first would leave a device whose
    // data is gone while the cloud still serves the old records.
    const response = await resetCloudWorkspace("business", config.workspaceId);
    resetEpoch = response.resetEpoch;
    deleted = response.deleted;
    setStoredResetEpoch(resetEpoch);
  } catch (error) {
    return {
      success: false,
      backupPath,
      error: `Central reset failed. Nothing was deleted on this device. ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const local = clearLocalBusinessData();
  if (!local.success) {
    return { success: false, backupPath, resetEpoch, error: local.error };
  }
  // Any queued offline operation from before the reset describes rows that
  // no longer exist centrally; replaying it would recreate them.
  clearAllSyncBookkeeping();
  return { success: true, backupPath, resetEpoch, deleted };
}

/** Complete reset: central business data + this device's factory reset. */
export async function performCompleteReset(input: { confirmation: string }): Promise<ResetOutcome> {
  if (String(input.confirmation).trim() !== "RESET") {
    return { success: false, error: "Type RESET (in capitals) to confirm a complete reset." };
  }

  let backupPath: string;
  try {
    backupPath = await backupBeforeReset("complete-reset");
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const config = getCloudConfig();
  const cloudConfigured = Boolean(config.enabled && config.apiUrl && config.workspaceId && config.apiKey);
  let resetEpoch: number | undefined;
  if (cloudConfigured) {
    try {
      const response = await resetCloudWorkspace("business", config.workspaceId);
      resetEpoch = response.resetEpoch;
      setStoredResetEpoch(resetEpoch);
    } catch (error) {
      return {
        success: false,
        backupPath,
        error: `Central reset failed, so the local factory reset was not run. ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  clearAllSyncBookkeeping();
  const local = performFactoryReset();
  if (!local.success) {
    return { success: false, backupPath, resetEpoch, error: local.error };
  }
  return { success: true, backupPath, resetEpoch };
}

/** Called by the sync engine when the Worker reports that this device's
 *  epoch is stale: the central copy is authoritative after a reset, so the
 *  pre-reset local copies and every mapping/cursor/queued operation for
 *  them are dropped before the new epoch is adopted. */
export async function rebaselineToResetEpoch(resetEpoch: number): Promise<void> {
  clearLocalBusinessData();
  clearAllSyncBookkeeping();
  setStoredResetEpoch(resetEpoch);
}
