import type { PermissionKey } from "../../../src/auth/permission-catalog";
import { hasPermission } from "../../../src/auth/permission-engine";
import { resolveUserPermissions } from "../../../src/repositories/permission-profile-repository";
import type { SafeUser, UserType } from "../../../src/repositories/user-repository";
import { getCurrentUser, logout } from "./auth-manager";
import { licenseManagerV2 } from "../license-v2/license-manager";

// ===================================================================
// Authorization (server-side RBAC enforcement)
//
// The single place every business-logic IPC handler in main.ts goes
// to answer "is the currently logged-in user allowed to do this?".
// Mirrors the pattern already used by user-manager.ts /
// password-reset-manager.ts (re-check the caller's session inside
// the main process, never trust the renderer) but generalized to the
// full PermissionKey catalog (Products/Customers/Orders/Invoices/
// Accounting/Employees/Certificates) instead of each handler
// re-implementing its own ad hoc check.
//
// Renderer-side hasPermission()/RequireModuleAccess (see
// src/auth/permission-engine.ts, src/components/auth/
// require-module-access.tsx) exist purely for UX -- hiding buttons
// and routes the user can't use. They are never the security
// boundary. This module, called from inside electron/main/main.ts's
// ipcMain.handle callbacks, is the actual boundary: even a renderer
// that has been tampered with (devtools, a modified preload call,
// etc.) cannot get past it, because it re-resolves the permission
// set from the database via the active session, not from anything
// the renderer sent.
// ===================================================================

/**
 * Re-reads the current session's user fresh from the database (via
 * auth-manager's getCurrentUser(), itself always a live DB lookup by
 * user id -- never a cached copy) and confirms both that a session
 * exists and that the account is still active. A user who is
 * disabled or archived *after* their session started is rejected on
 * their very next action rather than being able to keep acting under
 * a now-revoked account until they happen to close and reopen the
 * app -- the active session is also explicitly ended here so the
 * next call (and the renderer's next getCurrentUser()/restoreSession()
 * check) reflects that immediately.
 */
/**
 * SECURITY FIX (audit finding #1): before this fix, license validity
 * (activated / active trial) was enforced only by the renderer's
 * LicenseGate component -- a UI convenience, not a security boundary.
 * A renderer that had been tampered with (devtools console, a patched
 * bundle, etc.) could call any business IPC handler directly and it
 * would succeed as long as a login session existed, regardless of
 * whether the app was actually licensed. requireActiveUser() is the
 * single choke point requirePermission()/requireUserType() both go
 * through, so enforcing the license check here closes that gap for
 * every business-logic IPC handler in one place, without having to
 * touch each handler individually.
 *
 * `skipLicenseCheck` exists ONLY for the license-management actions
 * themselves (license:activate / license:deactivate /
 * license:importRevocationBundle in license-v2/ipc.ts, via
 * requireUserTypeAllowUnlicensed below) -- an Owner whose license has
 * expired or been revoked must still be able to reach those actions to
 * install a new one. No other caller should ever pass this.
 */
function requireActiveUser(options: { skipLicenseCheck?: boolean } = {}): SafeUser {

  const user = getCurrentUser();

  if (!user) {
    throw new Error("You must be signed in to perform this action.");
  }

  if (user.status !== "active") {

    logout();

    throw new Error("This account is no longer active. Please sign in again.");

  }

  if (!options.skipLicenseCheck) {

    const licenseStatus = licenseManagerV2.getStatus();

    if (!licenseStatus.activated) {
      throw new Error(
        "This installation is not licensed or your trial has ended. Please activate MBS to continue."
      );
    }

  }

  return user;

}

/**
 * Server-side equivalent of src/auth/permission-engine.ts's
 * hasPermission(), for use inside main-process IPC handlers. Throws
 * (rather than returning a boolean) so a handler can call this as its
 * very first line and let the thrown error propagate back to the
 * renderer as an IPC rejection, the same convention every existing
 * handler already uses for input-validation errors.
 */
export function requirePermission(permissionKey: PermissionKey): SafeUser {

  const user = requireActiveUser();

  // Owner/Administrator: unrestricted, same short-circuit as the
  // renderer engine -- resolving a permission set for them would be
  // meaningless (see permission-engine.ts's own comment on this).
  const grantedPermissions =
    user.user_type === "employee"
      ? resolveUserPermissions(user.id, user.permission_profile_id)
      : null;

  const allowed = hasPermission(
    { userType: user.user_type, grantedPermissions },
    permissionKey
  );

  if (!allowed) {
    throw new Error("You do not have permission to perform this action.");
  }

  return user;

}

/**
 * For the smaller set of capabilities that were never part of the
 * Products/Customers/Orders/... permission catalog to begin with
 * (Owner-only operations like Database Backup/Restore or License
 * Activation) -- restricts by user_type directly instead of by a
 * PermissionKey that doesn't exist for these.
 */
export function requireUserType(...allowedTypes: UserType[]): SafeUser {

  const user = requireActiveUser();

  if (!allowedTypes.includes(user.user_type)) {
    throw new Error("You do not have access to this action.");
  }

  return user;

}

/**
 * Identical to requireUserType() except it does NOT require an active
 * license/trial. Reserved exclusively for the license-management IPC
 * handlers themselves (activate / deactivate / importRevocationBundle)
 * -- see the comment on requireActiveUser()'s skipLicenseCheck option.
 * Every other owner-only action (backup/restore, factory reset, etc.)
 * must keep using requireUserType() above, never this.
 */
export function requireUserTypeAllowUnlicensed(...allowedTypes: UserType[]): SafeUser {

  const user = requireActiveUser({ skipLicenseCheck: true });

  if (!allowedTypes.includes(user.user_type)) {
    throw new Error("You do not have access to this action.");
  }

  return user;

}
