// ===================================================================
// Permission Engine (foundation)
// ===================================================================
//
// Per the Master Spec: "Never use role == admin. Build a permission
// engine." This is that engine's single entry point -- every place in
// the app that needs to know "can the current user do X" calls
// hasPermission(), never compares user_type directly.
//
// Phase 1 scope: only the Owner exists, and the Owner always has
// unrestricted access in both Business Modes (per spec). So today
// this resolves to a single short-circuit. Phase 2/3 add the real
// per-user/profile evaluation below the short-circuit -- callers
// never need to change when that lands, since they only ever call
// hasPermission().
//
// AuthContext.hasPermission() (see providers/auth-provider.tsx) is a
// thin wrapper around this function, bound to the current user's
// resolved permission set.

import type { PermissionKey } from "./permission-catalog";

export interface PermissionCheckContext {
  userType: "owner" | "administrator" | "employee";

  /**
   * The resolved, flat set of permission keys granted to the current
   * user (profile baseline + per-user overrides already merged).
   * Null for the Owner (whose access is never restricted, so nothing
   * needs to be resolved) and, until Phase 2/3 populate real
   * assignments, effectively unused for every other user type too.
   */
  grantedPermissions: Set<PermissionKey> | null;
}

export function hasPermission(
  context: PermissionCheckContext,
  permissionKey: PermissionKey
): boolean {

  // Owner: unrestricted access, always, in both Business Modes.
  //
  // Administrator: also unrestricted across this module/action catalog
  // -- the spec scopes Administrator restrictions to Owner-only
  // capabilities outside this catalog entirely (Business Mode,
  // License, Backup/Restore, ERP Reset, Factory Reset, modifying the
  // Owner), which are enforced separately (see e.g.
  // business-mode-service's owner-only check), never through
  // permission_profile assignment. Only Employee accounts are scoped
  // by an assigned profile + per-user overrides.
  if (context.userType === "owner" || context.userType === "administrator") {
    return true;
  }

  // Employee: no permission set resolved yet (e.g. still loading).
  // Fail closed -- an unresolved permission set must never be treated
  // as "allow everything".
  if (!context.grantedPermissions) {
    return false;
  }

  return context.grantedPermissions.has(permissionKey);

}
