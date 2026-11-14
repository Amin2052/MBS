import {
  createUserWithGeneratedUsername,
  listUsers,
  setUserStatus,
  toSafeUser,
  getUserById,
  updatePasswordHash,
  updateUserPermissionProfile,
  type UserWithEmployee
} from "../../../src/repositories/user-repository";

import { getEmployeesWithoutLogin, type Employee } from "../../../src/repositories/employee-repository";

import { getPermissionProfileById } from "../../../src/repositories/permission-profile-repository";

import { hashPassword, generateTemporaryPassword } from "./security/password";
import { getActiveSessionUserType } from "./auth-manager";
import type { SafeUser } from "../../../src/repositories/user-repository";
import { licenseManagerV2 } from "../license-v2/license-manager";

// ===================================================================
// User Manager
//
// Orchestrates Administrator/Employee account creation and lifecycle
// (Disable/Archive/Restore) for the User Management screen. Every
// exported function here re-checks authorization itself (who is
// calling, per auth-manager's active session) rather than trusting
// the IPC handler alone -- defense in depth, same as elsewhere in
// this codebase.
//
// Per the spec:
//   - Only the Owner may create/disable/archive/restore Administrators.
//   - The Owner or an Administrator may create/disable/archive/restore
//     Employees.
//   - Administrators never set passwords manually -- temporary
//     passwords are always system-generated, and the new account is
//     always created with must_change_password = true.
// ===================================================================

export interface CreateUserResult {
  success: boolean;
  user?: SafeUser;
  temporaryPassword?: string;
  error?: string;
}

function requireCallerType(): "owner" | "administrator" | "employee" | null {

  return getActiveSessionUserType();

}

/**
 * Requirement 10/11/19: Administrator/Employee accounts are an
 * Enterprise-only entitlement (Starter is single-Owner). This is the
 * actual enforcement point -- checked here, at account-creation time,
 * rather than only hiding the UI route -- since Business Mode must
 * come from the validated license entitlement, never trusted from the
 * renderer. Reuses the same licenseManagerV2.getStatus() call every
 * other Business Mode check in the app goes through.
 */
function assertEnterpriseMultiUser(): void {
  const status = licenseManagerV2.getStatus();
  if (status.businessMode !== "enterprise") {
    throw new Error(
      "Multiple user accounts require Enterprise. Upgrade your license to add Administrator or Employee logins."
    );
  }
}

export function listAllUsers(): UserWithEmployee[] {

  const callerType = requireCallerType();

  if (callerType !== "owner" && callerType !== "administrator") {
    throw new Error("You do not have access to User Management.");
  }

  return listUsers();

}

export function listEmployeesAvailableForLogin(): Employee[] {

  const callerType = requireCallerType();

  if (callerType !== "owner" && callerType !== "administrator") {
    throw new Error("You do not have access to User Management.");
  }

  return getEmployeesWithoutLogin();

}

export async function createAdministrator(): Promise<CreateUserResult> {

  const callerType = requireCallerType();

  if (callerType !== "owner") {
    return { success: false, error: "Only the Owner can create an Administrator account." };
  }

  try {
    assertEnterpriseMultiUser();
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Multiple user accounts require Enterprise." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const user = createUserWithGeneratedUsername("ADM", {
    user_type: "administrator",
    password_hash: passwordHash,
    employee_id: null,
    permission_profile_id: null,
    created_by: null
  });

  return {
    success: true,
    user: toSafeUser(user),
    temporaryPassword
  };

}

export async function createEmployeeLogin(
  employeeId: number,
  permissionProfileId: number
): Promise<CreateUserResult> {

  const callerType = requireCallerType();

  if (callerType !== "owner" && callerType !== "administrator") {
    return { success: false, error: "You do not have access to User Management." };
  }

  try {
    assertEnterpriseMultiUser();
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Multiple user accounts require Enterprise." };
  }

  if (!Number.isFinite(employeeId)) {
    return { success: false, error: "Please select an employee." };
  }

  const profile = getPermissionProfileById(permissionProfileId);

  if (!profile) {
    return { success: false, error: "Please select a valid permission profile." };
  }

  const eligibleEmployees = getEmployeesWithoutLogin();

  const employee = eligibleEmployees.find(candidate => candidate.id === employeeId);

  if (!employee) {
    return { success: false, error: "This employee already has a login account, or is not active." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const user = createUserWithGeneratedUsername("EMP", {
    user_type: "employee",
    password_hash: passwordHash,
    employee_id: employeeId,
    permission_profile_id: permissionProfileId,
    created_by: null
  });

  return {
    success: true,
    user: toSafeUser(user),
    temporaryPassword
  };

}

function assertCanManageTarget(targetUserId: number): void {

  const callerType = requireCallerType();

  if (callerType !== "owner" && callerType !== "administrator") {
    throw new Error("You do not have access to User Management.");
  }

  const target = getUserById(targetUserId);

  if (!target) {
    throw new Error("User not found.");
  }

  if (target.user_type === "owner") {
    throw new Error("The Owner account cannot be disabled, archived, or restored.");
  }

  // Only the Owner may disable/archive/restore an Administrator --
  // an Administrator managing "daily operations" is scoped to
  // Employee accounts (per spec: Administrator capabilities list
  // Employee account management only).
  if (target.user_type === "administrator" && callerType !== "owner") {
    throw new Error("Only the Owner can manage Administrator accounts.");
  }

}

export function disableUser(userId: number): { success: true } {

  assertCanManageTarget(userId);

  setUserStatus(userId, "disabled");

  return { success: true };

}

export function archiveUser(userId: number): { success: true } {

  assertCanManageTarget(userId);

  setUserStatus(userId, "archived");

  return { success: true };

}

export function restoreUser(userId: number): { success: true } {

  assertCanManageTarget(userId);

  setUserStatus(userId, "active");

  return { success: true };

}

/**
 * Password Reset (Phase 4): generates a brand-new system temporary
 * password for an existing Administrator or Employee account and
 * forces a change on next login -- the same rule as account creation,
 * since (per the spec) nobody, including an Administrator, ever sets
 * another user's password by hand. Also used to power "Reprint
 * Credentials": the original temporary password is never recoverable
 * (only its hash is stored), so reprinting an existing account's
 * credentials necessarily issues a fresh one.
 */
export async function resetUserPassword(userId: number): Promise<CreateUserResult> {

  assertCanManageTarget(userId);

  const target = getUserById(userId);

  if (!target) {
    return { success: false, error: "User not found." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  updatePasswordHash(userId, passwordHash, true);

  return {
    success: true,
    user: toSafeUser(getUserById(userId) as typeof target),
    temporaryPassword
  };

}

/**
 * Reassigns an existing Employee login to a different permission profile
 * (Owner/Administrator per spec: "assign/change permissions" is a core
 * User Management capability, not just a one-time choice at account
 * creation). Reuses assertCanManageTarget for the same caller/target
 * rules as disable/archive/restore/reset-password: Owner and
 * Administrator may call this, the Owner account itself can never be a
 * target, and only the Owner may act on an Administrator account (moot
 * here in practice since Administrators bypass profile-based
 * permissions entirely, but kept for consistency with every other
 * management action).
 */
export function changeUserPermissionProfile(
  userId: number,
  permissionProfileId: number
): { success: true } | { success: false; error: string } {

  assertCanManageTarget(userId);

  const target = getUserById(userId);

  if (!target) {
    return { success: false, error: "User not found." };
  }

  if (target.user_type !== "employee") {
    return { success: false, error: "Only Employee accounts have an assignable permission profile." };
  }

  const profile = getPermissionProfileById(permissionProfileId);

  if (!profile) {
    return { success: false, error: "Please select a valid permission profile." };
  }

  updateUserPermissionProfile(userId, permissionProfileId);

  return { success: true };

}
