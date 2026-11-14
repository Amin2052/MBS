import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { licenseManagerV2 } from "../license-v2/license-manager";

// ===================================================================
// Cloud Configuration (MBS side)
//
// The active license's licensedCloudConfig.mode decides where the real
// apiUrl/workspaceId/apiKey come from:
//
//   "developer_managed" (default for licenses without `mode`) -- these are
//   DEVELOPER PROPERTY: entered only in the Activation Generator and
//   shipped as part of the signed license. They are never read from, or
//   writable through, an unsigned local file or renderer input --
//   getCloudConfig() sources them exclusively from the currently active,
//   signature-verified license via licenseManagerV2, re-verified on every
//   call.
//
//   "customer_managed" -- the license only grants the *entitlement* to
//   connect a server; the license itself carries no real values. The
//   customer types their own personal/self-hosted server details into
//   MBS, and those are persisted locally (see customerConfigPath()) --
//   never part of, or checked against, the signed license.
//
// Regardless of mode, this module also persists `enabled` locally: a
// non-sensitive customer preference (turn the connection on/off), not a
// credential. It has no effect unless the active license actually grants
// a cloud entitlement.
// ===================================================================

export interface CloudConfig {
  enabled: boolean;
  mode: "developer_managed" | "customer_managed";
  apiUrl: string;
  workspaceId: string;
  apiKey: string;
}

/** Safe-to-render subset for the renderer.
 *  - developer_managed: apiKey never crosses IPC (apiKeyMasked only).
 *  - customer_managed: these are the customer's own values, entered by
 *    them, so apiUrl/workspaceId/apiKey are returned in full so the
 *    settings page can show/edit them; only apiKeyMasked is populated
 *    when the caller wants a display-only masked variant.
 */
export interface CloudConfigView {
  enabled: boolean;
  licensed: boolean;
  mode: "developer_managed" | "customer_managed";
  apiUrl: string;
  workspaceId: string;
  apiKey: string;
  apiKeyMasked: string;
}

const DEFAULT_CONFIG: CloudConfig = { enabled: false, mode: "developer_managed", apiUrl: "", workspaceId: "", apiKey: "" };

function preferencePath(): string { return path.join(app.getPath("userData"), "cloud-sync.json"); }

/** Customer-entered personal/self-hosted server details. Only ever
 *  written when the active license's mode is "customer_managed"; never
 *  part of, or validated against, the signed license itself. */
function customerConfigPath(): string { return path.join(app.getPath("userData"), "cloud-customer-config.json"); }

function getEnabledPreference(): boolean {
  try {
    if (!fs.existsSync(preferencePath())) return false;
    const raw = JSON.parse(fs.readFileSync(preferencePath(), "utf8"));
    return Boolean(raw.enabled);
  } catch { return false; }
}

/** Persists only the enabled/disabled preference -- never credentials. */
export function setCloudEnabledPreference(enabled: boolean): void {
  fs.writeFileSync(preferencePath(), JSON.stringify({ enabled: Boolean(enabled) }, null, 2), { mode: 0o600 });
}

/**
 * Wipes the customer-managed server config and the enabled preference,
 * resetting cloud connectivity to a clean, disconnected slate. Called by
 * license-manager.ts (see the comment there) whenever a NEW license with
 * a DIFFERENT licenseId than whatever was previously active gets saved --
 * this is what stops a stale customer_managed apiUrl/workspaceId/apiKey
 * from a PREVIOUS customer/license silently surviving onto a
 * DIFFERENT one activated later on the same installation. Both files
 * this touches are plain local preference/config files scoped to this
 * userData directory, not to any particular license -- without this,
 * nothing would ever clear them across an activation change (confirmed:
 * grepped for every reference to customerConfigPath()/preferencePath()
 * before adding this, and neither was ever deleted anywhere).
 */
export function clearCustomerCloudConfigAndPreference(): void {
  try { fs.unlinkSync(customerConfigPath()); } catch { /* nothing to clear */ }
  try { fs.unlinkSync(preferencePath()); } catch { /* nothing to clear */ }
}

function getCustomerManagedConfig(): { apiUrl: string; workspaceId: string; apiKey: string } {
  try {
    if (!fs.existsSync(customerConfigPath())) return { apiUrl: "", workspaceId: "", apiKey: "" };
    const raw = JSON.parse(fs.readFileSync(customerConfigPath(), "utf8"));
    return {
      apiUrl: typeof raw.apiUrl === "string" ? raw.apiUrl : "",
      workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : "",
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : ""
    };
  } catch {
    return { apiUrl: "", workspaceId: "", apiKey: "" };
  }
}

/**
 * Saves the customer's own personal/self-hosted server details locally.
 * Only meaningful when the active license grants a "customer_managed"
 * cloud entitlement -- callers (IPC handler) must check that first, since
 * this function itself has no way to see the license and must not be the
 * place that enforces entitlement.
 */
export function setCustomerManagedConfig(config: { apiUrl: string; workspaceId: string; apiKey: string }): void {
  const normalized = {
    apiUrl: typeof config.apiUrl === "string" ? config.apiUrl.trim() : "",
    workspaceId: typeof config.workspaceId === "string" ? config.workspaceId.trim() : "",
    apiKey: typeof config.apiKey === "string" ? config.apiKey : ""
  };
  fs.writeFileSync(customerConfigPath(), JSON.stringify(normalized, null, 2), { mode: 0o600 });
}

/**
 * Effective cloud configuration used internally by cloud-client.ts and
 * cloud-sync-manager.ts. In developer_managed mode, apiUrl/workspaceId/
 * apiKey always come from the freshly re-verified active license -- never
 * from customer input. In customer_managed mode, they come from the
 * customer's own locally-stored value -- never from the license, which
 * carries no real values for that mode. `enabled` combines the customer's
 * local on/off preference with the license actually granting the
 * entitlement (a customer cannot enable cloud connectivity that no valid
 * license grants).
 */
export function getCloudConfig(): CloudConfig {
  const licensed = licenseManagerV2.getVerifiedCloudConfig();
  if (!licensed) return { ...DEFAULT_CONFIG };
  const wantsEnabled = getEnabledPreference();
  const enabled = wantsEnabled && licensed.enabled;

  if (licensed.mode === "customer_managed") {
    const custom = getCustomerManagedConfig();
    return { enabled, mode: "customer_managed", apiUrl: custom.apiUrl, workspaceId: custom.workspaceId, apiKey: custom.apiKey };
  }

  return { enabled, mode: "developer_managed", apiUrl: licensed.apiUrl, workspaceId: licensed.workspaceId, apiKey: licensed.apiKey };
}

/**
 * View sent to the renderer.
 *  - developer_managed: apiKey is masked, apiUrl/workspaceId shown as
 *    read-only informational values (the customer cannot edit them).
 *  - customer_managed: apiUrl/workspaceId/apiKey are the customer's own
 *    values, returned in full so the settings page can display and let
 *    them edit these fields; apiKeyMasked is also provided for a
 *    display-only masked rendering if the UI prefers that by default.
 */
export function getCloudConfigView(): CloudConfigView {
  const licensed = licenseManagerV2.getVerifiedCloudConfig();
  const wantsEnabled = getEnabledPreference();
  const mode: "developer_managed" | "customer_managed" = licensed?.mode === "customer_managed" ? "customer_managed" : "developer_managed";

  if (mode === "customer_managed") {
    const custom = getCustomerManagedConfig();
    return {
      enabled: wantsEnabled && Boolean(licensed?.enabled),
      licensed: Boolean(licensed),
      mode,
      apiUrl: custom.apiUrl,
      workspaceId: custom.workspaceId,
      apiKey: custom.apiKey,
      apiKeyMasked: custom.apiKey ? "••••••••" : ""
    };
  }

  return {
    enabled: wantsEnabled && Boolean(licensed?.enabled),
    licensed: Boolean(licensed),
    mode,
    apiUrl: licensed?.apiUrl ?? "",
    workspaceId: licensed?.workspaceId ?? "",
    apiKey: "",
    apiKeyMasked: licensed?.apiKey ? "••••••••" : ""
  };
}

// Stable per-installation identifier used to build globally-unique cloud
// sync identities (see cloud-sync-manager.ts). Generated once and persisted
// locally; never sent anywhere except as a namespace prefix inside a synced
// record's `local_id`. This solves the "two PCs each create record #7
// offline before either has synced" collision: the composite id becomes
// `${deviceId}:${table}:${row.id}`, which is unique across devices even
// though the raw autoincrement `row.id` is only unique within one device's
// local SQLite. No change to MBS's local schema is required for this.
function deviceIdPath(): string { return path.join(app.getPath("userData"), "cloud-device-id.json"); }

let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    if (fs.existsSync(deviceIdPath())) {
      const raw = JSON.parse(fs.readFileSync(deviceIdPath(), "utf8"));
      if (typeof raw.deviceId === "string" && raw.deviceId) {
        const resolved: string = raw.deviceId;
        cachedDeviceId = resolved;
        return resolved;
      }
    }
  } catch { /* fall through to generation */ }
  const generated = crypto.randomUUID();
  try {
    fs.writeFileSync(deviceIdPath(), JSON.stringify({ deviceId: generated, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch { /* best-effort persistence; still usable for this process lifetime */ }
  cachedDeviceId = generated;
  return cachedDeviceId;
}

// Test-only: getDeviceId() intentionally caches at module scope (a real
// installation only ever has one device id for its whole process
// lifetime). That's invisible in production (every PC is a separate OS
// process), but it means two "installations" simulated in the SAME test
// process by swapping app.setPath("userData", ...) would otherwise share
// one cached device id -- which would make cloud-sync-manager.ts's
// "skip our own echo" pull logic (see pullTable()) incorrectly treat one
// simulated device's pushes as the other device's own echo and skip
// applying them, silently breaking exactly the pull path being tested.
// Call this after switching userData dirs in a test, before the next
// getDeviceId() call for the "new" device.
export function _resetDeviceIdCacheForTests(): void { cachedDeviceId = null; }
