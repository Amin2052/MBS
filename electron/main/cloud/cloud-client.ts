import { getCloudConfig } from "./cloud-config-service";
import { getStoredResetEpoch } from "./sync-epoch";

function baseUrl(): string {
  const url = getCloudConfig().apiUrl.trim().replace(/\/+$/, "");
  if (!url) throw new Error("Cloud API URL is not configured.");
  return url;
}
function headers(extra: Record<string,string> = {}): Record<string,string> {
  const c = getCloudConfig();
  if (!c.workspaceId || !c.apiKey) throw new Error("Cloud workspace and API key are not configured.");
  // Every request states the reset epoch this device believes it is syncing
  // against. The Worker refuses WRITES from a stale epoch (409) and never
  // blocks reads -- see cloudflare/worker/index.js resetEpochMismatch().
  return { "x-workspace-id": c.workspaceId, "x-api-key": c.apiKey, "x-reset-epoch": String(getStoredResetEpoch()), ...extra };
}

export async function cloudHealth() {
  const r = await fetch(`${baseUrl()}/health`, { headers: headers() });
  return { success: r.ok, status: r.status, detail: await r.text() };
}

export async function listCloudUsers() {
  const r = await fetch(`${baseUrl()}/v1/users`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text() || `Cloud users failed (${r.status}).`);
  return await r.json() as Array<{ username: string; full_name: string; user_type: string; status: string }>;
}

export async function upsertCloudUser(user: { username: string; full_name: string; user_type: string; status: string; password_hash: string; employee_id?: number | null; permission_profile_id?: number | null; must_change_password?: number }) {
  const r = await fetch(`${baseUrl()}/v1/users`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify(user) });
  if (!r.ok) throw new Error(await r.text() || `Cloud user sync failed (${r.status}).`);
  return await r.json();
}


export async function syncCloudPermissions(payload: {
  profiles: Array<{ id: number; name: string; description?: string; is_system?: number }>;
  profilePermissions: Array<{ profile_id: number; permission_key: string; allowed: number }>;
  userPermissions: Array<{ user_id: number; permission_key: string; allowed: number }>;
}) {
  const r = await fetch(`${baseUrl()}/v1/admin/permissions/sync`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text() || `Cloud permission sync failed (${r.status}).`);
  return await r.json() as { success: boolean };
}

export async function sendCloudMessage(input: Record<string, unknown>, username?: string) {
  const r = await fetch(`${baseUrl()}/v1/messages`, { method: "POST", headers: headers({ "content-type": "application/json", ...(username ? { "x-user": username } : {}) }), body: JSON.stringify(input) });
  if (!r.ok) throw new Error(await r.text() || `Cloud message send failed (${r.status}).`);
  return await r.json();
}

export async function listCloudMessages(username: string) {
  const r = await fetch(`${baseUrl()}/v1/messages?user=${encodeURIComponent(username)}`, { headers: headers({ "x-user": username }) });
  if (!r.ok) throw new Error(await r.text() || `Cloud messages failed (${r.status}).`);
  return await r.json() as Array<Record<string, any>>;
}

export async function updateCloudMessage(remoteId: string, patch: Record<string, unknown>, username?: string) {
  const r = await fetch(`${baseUrl()}/v1/messages/${encodeURIComponent(remoteId)}`, { method: "PATCH", headers: headers({ "content-type": "application/json", ...(username ? { "x-user": username } : {}) }), body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(await r.text() || `Cloud message update failed (${r.status}).`);
  return await r.json();
}

export type CloudRecord = Record<string, unknown>;

export async function listCloudRecords(table: string, limit = 500, since?: string) {
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : "";
  const r = await fetch(`${baseUrl()}/v1/data/${encodeURIComponent(table)}?limit=${Math.min(Math.max(limit, 1), 2000)}${sinceParam}`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text() || `Cloud ${table} read failed (${r.status}).`);
  return await r.json() as { rows: CloudRecord[]; count: number };
}

export class CloudSyncConflictError extends Error {
  collection: string;
  column: string;
  value: unknown;
  localId: string;
  constructor(info: { collection: string; column: string; value: unknown; local_id: string; message: string }) {
    super(info.message);
    this.name = "CloudSyncConflictError";
    this.collection = info.collection;
    this.column = info.column;
    this.value = info.value;
    this.localId = info.local_id;
  }
}

export class CloudSyncRevisionConflictError extends Error {
  collection: string;
  localId: string;
  expectedRevision: number;
  currentRevision: number;
  current: CloudRecord | null;
  constructor(info: { collection: string; local_id: string; expected_revision: number; current_revision: number; current: CloudRecord | null; message: string }) {
    super(info.message);
    this.name = "CloudSyncRevisionConflictError";
    this.collection = info.collection;
    this.localId = info.local_id;
    this.expectedRevision = info.expected_revision;
    this.currentRevision = info.current_revision;
    this.current = info.current;
  }
}

export async function createCloudRecord(table: string, record: CloudRecord) {
  const r = await fetch(`${baseUrl()}/v1/data/${encodeURIComponent(table)}`, {
    method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify(record)
  });
  if (!r.ok) {
    const bodyText = await r.text();
    throwIfResetEpochConflict(r.status, bodyText);
    if (r.status === 409) {
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && parsed.error === "business_key_conflict") throw new CloudSyncConflictError(parsed);
      } catch (parseError) {
        if (parseError instanceof CloudSyncConflictError) throw parseError;
        // fall through to generic error below if the body wasn't the expected JSON shape
      }
    }
    throw new Error(bodyText || `Cloud ${table} create failed (${r.status}).`);
  }
  return await r.json() as { success: boolean; id: string | number; updated_at?: string; sync_revision?: number };
}

export async function updateCloudRecord(table: string, id: string | number, patch: CloudRecord, expectedRevision?: number) {
  const body = expectedRevision === undefined ? patch : { ...patch, expected_revision: expectedRevision };
  const r = await fetch(`${baseUrl()}/v1/data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}`, {
    method: "PATCH", headers: headers({ "content-type": "application/json" }), body: JSON.stringify(body)
  });
  if (!r.ok) {
    const bodyText = await r.text();
    throwIfResetEpochConflict(r.status, bodyText);
    if (r.status === 409) {
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && parsed.error === "revision_conflict") throw new CloudSyncRevisionConflictError(parsed);
      } catch (parseError) {
        if (parseError instanceof CloudSyncRevisionConflictError) throw parseError;
      }
    }
    throw new Error(bodyText || `Cloud ${table} update failed (${r.status}).`);
  }
  return await r.json() as { success: boolean; updated_at?: string; sync_revision?: number };
}

export async function deleteCloudRecord(table: string, id: string | number) {
  const r = await fetch(`${baseUrl()}/v1/data/${encodeURIComponent(table)}/${encodeURIComponent(String(id))}`, {
    method: "DELETE", headers: headers()
  });
  if (!r.ok) {
    const bodyText = await r.text();
    throwIfResetEpochConflict(r.status, bodyText);
    throw new Error(bodyText || `Cloud ${table} delete failed (${r.status}).`);
  }
  return await r.json() as { success: boolean };
}

// ===================================================================
// Cloud reset
// ===================================================================

export class CloudResetRequiredError extends Error {
  currentEpoch: number;
  constructor(currentEpoch: number) {
    super("The central business data was reset. This device must re-baseline before it can write again.");
    this.name = "CloudResetRequiredError";
    this.currentEpoch = currentEpoch;
  }
}

// Recognises the Worker's two epoch rejections without rethrowing a JSON
// parse error for every other 409 (business-key and revision conflicts have
// their own handling in the callers below).
function throwIfResetEpochConflict(status: number, bodyText: string): void {
  if (status !== 409) return;
  let parsed: any;
  try { parsed = JSON.parse(bodyText); } catch { return; }
  if (parsed && (parsed.error === "reset_epoch_mismatch" || parsed.error === "reset_epoch_required")) {
    throw new CloudResetRequiredError(Number(parsed.reset_epoch) || 0);
  }
}

export async function getCloudWorkspaceInfo(): Promise<{ workspaceId: string; resetEpoch: number }> {
  const r = await fetch(`${baseUrl()}/v1/workspace`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text() || `Cloud workspace lookup failed (${r.status}).`);
  const body = await r.json() as { workspaceId?: string; resetEpoch?: number };
  return { workspaceId: String(body.workspaceId || ""), resetEpoch: Number(body.resetEpoch) || 0 };
}

export async function resetCloudWorkspace(scope: "business", confirmWorkspace: string): Promise<{ success: boolean; resetEpoch: number; deleted: Record<string, number> }> {
  const r = await fetch(`${baseUrl()}/v1/admin/reset`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ scope, confirm: confirmWorkspace })
  });
  const bodyText = await r.text();
  if (!r.ok) {
    throwIfResetEpochConflict(r.status, bodyText);
    throw new Error(bodyText || `Cloud reset failed (${r.status}).`);
  }
  const parsed = JSON.parse(bodyText) as { resetEpoch?: number; deleted?: Record<string, number> };
  return { success: true, resetEpoch: Number(parsed.resetEpoch) || 0, deleted: parsed.deleted || {} };
}
