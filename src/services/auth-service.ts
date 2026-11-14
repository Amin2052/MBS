/**
 * Mooral Business Suite
 * Authentication — Renderer Service
 *
 * Pure renderer-side service, following the same pattern as every
 * other renderer service (license-service.ts, company-settings-
 * service.ts, etc.): no Node/Electron logic here, only calls through
 * the contextBridge API on `window.mooral.auth` / `window.mooral.businessMode`.
 * All real authentication logic (hashing, session tokens, Remember Me
 * storage) lives in the main process's auth-manager.ts.
 */

export async function checkSetupRequired(): Promise<boolean> {

  return window.mooral.auth.checkSetupRequired();

}

export async function setupOwner(
  username: string,
  password: string
): Promise<AuthResult> {

  return window.mooral.auth.setupOwner({ username, password });

}

export async function login(
  username: string,
  password: string,
  rememberMe: boolean
): Promise<AuthResult> {

  return window.mooral.auth.login({ username, password, rememberMe });

}

export async function logout(): Promise<{ success: boolean }> {

  return window.mooral.auth.logout();

}

export async function restoreSession(): Promise<{ user: SafeUser } | null> {

  return window.mooral.auth.restoreSession();

}

export async function getCurrentUser(): Promise<SafeUser | null> {

  return window.mooral.auth.getCurrentUser();

}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<AuthResult> {

  return window.mooral.auth.changePassword({ currentPassword, newPassword });

}

export async function getMyPermissions(): Promise<string[] | null> {

  return window.mooral.auth.getMyPermissions();

}

// ===============================
// EDIT PROFILE / PROFILE PICTURE
// ===============================

export async function updateProfile(data: {
  username: string;
  fullName?: string;
  email?: string;
  phone?: string;
  designation?: string;
}): Promise<AuthResult> {

  return window.mooral.auth.updateProfile(data);

}

export async function getMyProfilePhoto(): Promise<string | null> {

  return window.mooral.auth.getMyProfilePhoto();

}

// Profile photo change bridge: profile-page.tsx (owner of the actual
// save/remove calls) fires this after a successful change so the topbar
// avatar (which fetches its own copy on mount, for the refresh/re-login
// case) can update immediately in the same session too.
const PROFILE_PHOTO_CHANGED_EVENT = "mooral:profile-photo-changed";

export function notifyProfilePhotoChanged(photo: string | null): void {

  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<string | null>(PROFILE_PHOTO_CHANGED_EVENT, { detail: photo })
  );

}

export function onProfilePhotoChanged(
  handler: (photo: string | null) => void
): () => void {

  function listener(event: Event): void {
    handler((event as CustomEvent<string | null>).detail);
  }

  window.addEventListener(PROFILE_PHOTO_CHANGED_EVENT, listener);

  return () => window.removeEventListener(PROFILE_PHOTO_CHANGED_EVENT, listener);

}

export async function pickProfilePhoto(): Promise<{ dataUrl: string; mime: string } | null> {

  return window.mooral.auth.pickProfilePhoto();

}

export async function saveProfilePhoto(photoDataUrl: string): Promise<{ success: boolean }> {

  return window.mooral.auth.saveProfilePhoto({ photoDataUrl });

}

export async function removeProfilePhoto(): Promise<{ success: boolean }> {

  return window.mooral.auth.removeProfilePhoto();

}

// ===============================
// OFFLINE ACCOUNT RECOVERY (Forgot Username / Forgot Password)
// ===============================
//
// Both flows verify identity locally, with no SMS/email/online
// service: Full Name, Citizen ID/Residence ID number, Date of Birth
// and Employee ID, all checked against the SAME linked employee
// record. On failure a single generic error is returned (never which
// field mismatched, or whether an account exists) and no request is
// created -- see password-reset-manager.ts.

export async function requestPasswordReset(
  identityNumber: string,
  dateOfBirth: string,
  employeeId: string
): Promise<{ success: boolean; error?: string }> {

  return window.mooral.passwordReset.request({ identityNumber, dateOfBirth, employeeId });

}

export async function requestUsernameRecovery(
  identityNumber: string,
  dateOfBirth: string,
  employeeId: string
): Promise<{ success: boolean; error?: string }> {

  return window.mooral.passwordReset.requestUsername({ identityNumber, dateOfBirth, employeeId });

}

export async function approveUsernameRecoveryRequest(
  requestId: number
): Promise<{ success: boolean; error?: string }> {

  return window.mooral.passwordReset.approveUsername(requestId);

}

export async function listPendingPasswordResetRequests(): Promise<PasswordResetRequestRecord[]> {

  return window.mooral.passwordReset.listPending();

}

export async function listPasswordResetRequestHistory(): Promise<PasswordResetRequestRecord[]> {

  return window.mooral.passwordReset.listHistory();

}

export async function getPasswordResetAuditLog(requestId: number): Promise<PasswordResetAuditLogRecord[]> {

  return window.mooral.passwordReset.auditLog(requestId);

}

export async function generatePasswordResetCode(
  requestId: number
): Promise<{ success: boolean; resetCode?: string; error?: string }> {

  return window.mooral.passwordReset.generateCode(requestId);

}

export async function redeemPasswordResetCode(
  username: string,
  resetCode: string,
  newPassword: string
): Promise<AuthResult> {

  return window.mooral.passwordReset.redeem({ username, resetCode, newPassword });

}

export async function verifyOwnerRecoveryKey(
  username: string,
  recoveryKey: string
): Promise<{ success: boolean; error?: string }> {

  return window.mooral.passwordReset.verifyOwnerRecoveryKey({ username, recoveryKey });

}

export async function resetOwnerPasswordWithRecoveryKey(
  username: string,
  recoveryKey: string,
  newPassword: string
): Promise<AuthResult> {

  return window.mooral.passwordReset.resetOwnerWithRecoveryKey({ username, recoveryKey, newPassword });

}

export async function getBusinessMode(): Promise<BusinessMode> {

  return window.mooral.businessMode.get();

}

// ===============================
// USER MANAGEMENT (Phase 2)
// ===============================

export async function listUsers(): Promise<UserWithEmployee[]> {

  return window.mooral.users.list();

}

export async function listEmployeesAvailableForLogin(): Promise<Employee[]> {

  return window.mooral.users.employeesAvailableForLogin();

}

export async function createAdministrator(): Promise<CreateUserResult> {

  return window.mooral.users.createAdministrator();

}

export async function createEmployeeLogin(
  employeeId: number,
  permissionProfileId: number
): Promise<CreateUserResult> {

  return window.mooral.users.createEmployeeLogin({ employeeId, permissionProfileId });

}

export async function disableUser(userId: number): Promise<{ success: boolean }> {

  return window.mooral.users.disable(userId);

}

export async function archiveUser(userId: number): Promise<{ success: boolean }> {

  return window.mooral.users.archive(userId);

}

export async function restoreUser(userId: number): Promise<{ success: boolean }> {

  return window.mooral.users.restore(userId);

}

export async function resetUserPassword(userId: number): Promise<CreateUserResult> {

  return window.mooral.users.resetPassword(userId);

}

export async function exportCredentialsPdf(
  html: string,
  fileName: string
): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }> {

  return window.mooral.credentials.exportPdf({ html, fileName });

}

// ===============================
// PERMISSION PROFILES (Phase 2)
// ===============================

export async function listPermissionProfiles(): Promise<PermissionProfileWithKeys[]> {

  return window.mooral.permissionProfiles.list();

}

export async function createPermissionProfile(
  name: string,
  description: string,
  permissionKeys: string[]
): Promise<PermissionProfileWithKeys> {

  return window.mooral.permissionProfiles.create({ name, description, permissionKeys });

}

export async function updatePermissionProfile(
  id: number,
  name: string,
  description: string,
  permissionKeys: string[]
): Promise<PermissionProfileWithKeys> {

  return window.mooral.permissionProfiles.update({ id, name, description, permissionKeys });

}

export async function deletePermissionProfile(id: number): Promise<{ success: boolean }> {

  return window.mooral.permissionProfiles.delete(id);

}
