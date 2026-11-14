import {
  getUserById,
  getUserByUsername,
  findUserByOfflineIdentity,
  updatePasswordHash,
  toSafeUser,
  listUserIdsByType,
  type SafeUser
} from "../../../src/repositories/user-repository";

import {
  createPasswordResetRequest,
  getPasswordResetRequestById,
  getPendingRequestForUser,
  getActiveApprovedRequestForUser,
  listPendingRequestsForReviewer,
  listRequestHistoryForReviewer,
  approvePasswordResetRequest,
  completePasswordResetRequest,
  markPasswordResetCodeUsed,
  insertPasswordResetAuditEvent,
  listAuditLogForRequest,
  type PasswordResetRequestWithUsername,
  type PasswordResetAuditLogRecord
} from "../../../src/repositories/password-reset-repository";

import { hashPassword, verifyPassword, isPasswordStrongEnough, generateResetCode } from "./security/password";
import { getActiveSessionUserType, getCurrentUser } from "./auth-manager";
import { sendSystemMessage } from "../messaging-manager";

// ===================================================================
// Password Reset Manager / Offline Account Recovery
//
// Mirrors user-manager.ts's role: the single main-process authority
// for the request/approve/redeem flow. Two halves, matching who is
// calling:
//
//   - requestPasswordReset / requestUsernameRecovery / redeemPasswordResetCode
//     run with NO active session -- they're called from the Login
//     screen by someone who, by definition, cannot log in right now.
//     Identity is verified purely offline/locally, against the
//     Citizen ID / Residence ID number + Date of Birth already stored
//     on the requester's linked employee record (see
//     findUserByOfflineIdentity in user-repository.ts) -- no SMS, no
//     email, no online service of any kind.
//
//   - listPendingPasswordResetRequests / listPasswordResetRequestHistory /
//     generateResetCodeForRequest / approveUsernameRecoveryRequest
//     require an active session and re-check the caller's user_type
//     themselves (defense in depth, same convention as user-manager.ts),
//     since only an Administrator/Owner can review and approve a
//     request.
//
// The Owner is never a valid target of this flow -- Owner recovery is
// the separate Recovery Key path in auth-manager.ts.
//
// Neither flow ever reveals anything to the requester automatically.
// Once an Administrator/Owner approves a request, the outcome (a
// one-time Reset Code, or the account's existing username) is
// delivered to the requester exclusively through the internal
// Messages system (see messaging-manager.ts's sendSystemMessage) --
// never shown back to the requester's own browser/session directly,
// and an existing password is never displayed anywhere.
//
// Every state transition (requested / approved / completed / expired)
// is mirrored into password_reset_audit_log via
// insertPasswordResetAuditEvent -- an append-only trail kept
// independently of password_reset_requests' live status column, for
// later review (who requested, who approved, who generated the code,
// when it was generated/used/expired).
// ===================================================================

const RESET_CODE_TTL_MINUTES = 15;

export interface RequestPasswordResetResult {
  success: boolean;
  error?: string;
}

export interface GenerateResetCodeResult {
  success: boolean;
  resetCode?: string;
  error?: string;
}

export interface RedeemResetCodeResult {
  success: boolean;
  user?: SafeUser;
  error?: string;
}

/**
 * Notifies every eligible reviewer's inbox that a new recovery
 * request is waiting -- Administrators review Employee requests, the
 * Owner reviews Administrator requests. This is the "send the request
 * to the Admin through the internal messaging/request system" step;
 * the request itself still lives in password_reset_requests (so the
 * Request History / audit trail keep working), this just makes sure
 * it isn't only discoverable by opening User Management.
 */
function notifyReviewersOfNewRequest(
  requesterFullName: string,
  requesterUserType: "employee" | "administrator",
  kind: "username" | "password"
): void {

  const reviewerType: "administrator" | "owner" = requesterUserType === "administrator" ? "owner" : "administrator";

  const reviewerIds = listUserIdsByType(reviewerType);

  // An Administrator request can only be approved by the Owner, but
  // the Owner should also see Employee requests land (same
  // "unrestricted access" rule the review lists already apply) --
  // Administrators reviewing Employee requests get it above; also
  // loop in the Owner for visibility either way.
  const ownerIds = reviewerType === "administrator" ? listUserIdsByType("owner") : [];

  const subject = kind === "password" ? "New Password Reset Request" : "New Username Recovery Request";
  const body =
    `${requesterFullName} (${requesterUserType === "administrator" ? "Administrator" : "Employee"}) has requested ` +
    `${kind === "password" ? "a password reset" : "their username"} through offline identity verification. ` +
    `Open Settings > User Management > Password Reset Requests to review and approve.`;

  for (const recipientId of [...reviewerIds, ...ownerIds]) {
    sendSystemMessage(null, "System", recipientId, subject, body, "account_recovery");
  }

}

export function requestPasswordReset(
  identityNumber: string,
  dateOfBirth: string,
  employeeId: string
): RequestPasswordResetResult {

  const user = findUserByOfflineIdentity(identityNumber, dateOfBirth, employeeId);

  if (!user) {
    // Generic verification-failure message -- same wording regardless
    // of which field(s) didn't match or whether any account exists,
    // so it never confirms/denies a specific username. No request is
    // created and the renderer stays on the form.
    return {
      success: false,
      error: "Information does not match our records. Please check your information and try again."
    };
  }

  // Prevent duplicate requests from piling up: if this user already
  // has a pending request awaiting review, or an approved request
  // whose reset code hasn't been used or expired yet, don't create
  // another one underneath it -- the existing request is still
  // actionable.
  if (getPendingRequestForUser(user.id, "password")) {
    return {
      success: false,
      error: "A password reset request for this account is already pending review."
    };
  }

  if (getActiveApprovedRequestForUser(user.id)) {
    return {
      success: false,
      error: "A password reset code has already been issued for this account and has not expired yet."
    };
  }

  const userType = user.user_type as "employee" | "administrator";

  const request = createPasswordResetRequest(user.id, userType, "password");

  insertPasswordResetAuditEvent(
    request.id,
    "requested",
    user.id,
    `${userType === "administrator" ? "Administrator" : "Employee"} "${user.username}" (${user.full_name || user.username}) requested a password reset (identity verified offline).`
  );

  notifyReviewersOfNewRequest(user.full_name || user.username, userType, "password");

  return { success: true };

}

/**
 * Forgot Username. Same offline identity check as Forgot Password,
 * but there is no code to redeem -- once an Administrator/Owner
 * approves the request, the account's existing username is delivered
 * straight to the requester's Messages inbox (approveUsernameRecoveryRequest).
 */
export function requestUsernameRecovery(
  identityNumber: string,
  dateOfBirth: string,
  employeeId: string
): RequestPasswordResetResult {

  const user = findUserByOfflineIdentity(identityNumber, dateOfBirth, employeeId);

  if (!user) {
    return {
      success: false,
      error: "Information does not match our records. Please check your information and try again."
    };
  }

  if (getPendingRequestForUser(user.id, "username")) {
    return {
      success: false,
      error: "A username recovery request for this account is already pending review."
    };
  }

  const userType = user.user_type as "employee" | "administrator";

  const request = createPasswordResetRequest(user.id, userType, "username");

  insertPasswordResetAuditEvent(
    request.id,
    "requested",
    user.id,
    `${userType === "administrator" ? "Administrator" : "Employee"} "${user.username}" (${user.full_name || user.username}) requested username recovery (identity verified offline).`
  );

  notifyReviewersOfNewRequest(user.full_name || user.username, userType, "username");

  return { success: true };

}

export function listPendingPasswordResetRequests(): PasswordResetRequestWithUsername[] {

  const callerType = requireReviewer();

  return listPendingRequestsForReviewer(callerType);

}

/**
 * Full history (all statuses, all time) for the Request History view --
 * same reviewer scoping as the pending list.
 */
export function listPasswordResetRequestHistory(): PasswordResetRequestWithUsername[] {

  const callerType = requireReviewer();

  return listRequestHistoryForReviewer(callerType);

}

export function getPasswordResetAuditLog(requestId: number): PasswordResetAuditLogRecord[] {

  requireReviewer();

  return listAuditLogForRequest(requestId);

}

export async function generateResetCodeForRequest(requestId: number): Promise<GenerateResetCodeResult> {

  const callerType = getActiveSessionUserType();

  if (callerType !== "owner" && callerType !== "administrator") {
    return { success: false, error: "You do not have access to Password Reset Requests." };
  }

  const request = getPasswordResetRequestById(requestId);

  if (!request || request.status !== "pending" || request.request_type !== "password") {
    return { success: false, error: "This request is no longer pending." };
  }

  // An Administrator may only approve Employee requests -- Administrator
  // requests can only be approved by the Owner, per spec.
  if (request.user_type === "administrator" && callerType !== "owner") {
    return { success: false, error: "Only the Owner can approve an Administrator's reset request." };
  }

  const reviewer = getCurrentUser();

  if (!reviewer) {
    return { success: false, error: "Your session could not be verified. Please sign in again." };
  }

  const resetCode = generateResetCode();
  const resetCodeHash = await hashPassword(resetCode);
  // Unix seconds, not an ISO string -- see the comment on
  // reset_code_expires_at in password-reset-repository.ts for why.
  const expiresAtUnixSeconds = Math.floor(Date.now() / 1000) + RESET_CODE_TTL_MINUTES * 60;

  approvePasswordResetRequest(requestId, resetCodeHash, expiresAtUnixSeconds, reviewer.id);

  insertPasswordResetAuditEvent(
    requestId,
    "approved",
    reviewer.id,
    `Reset code generated by ${reviewer.full_name || reviewer.username}, expires in ${RESET_CODE_TTL_MINUTES} minutes.`
  );

  const requestedUser = getUserById(request.user_id);

  if (requestedUser) {
    sendSystemMessage(
      reviewer.id,
      reviewer.full_name || reviewer.username,
      requestedUser.id,
      "Your Password Reset Code",
      `Your password reset request has been approved. Your one-time Reset Code is: ${resetCode}\n\n` +
        `This code expires in ${RESET_CODE_TTL_MINUTES} minutes and can only be used once. Return to the ` +
        `Forgot Password screen, choose "Already have a Reset Code?", and enter it along with your new password.`,
      "account_recovery"
    );
  }

  return { success: true, resetCode };

}

/**
 * Approves a pending Forgot Username request: looks up the account's
 * existing username and delivers it to the requester's Messages
 * inbox. There is nothing to "generate" here (unlike the password
 * flow) -- the username already exists -- so this goes straight from
 * 'pending' to 'completed'.
 */
export async function approveUsernameRecoveryRequest(requestId: number): Promise<{ success: boolean; error?: string }> {

  const callerType = getActiveSessionUserType();

  if (callerType !== "owner" && callerType !== "administrator") {
    return { success: false, error: "You do not have access to Username Recovery Requests." };
  }

  const request = getPasswordResetRequestById(requestId);

  if (!request || request.status !== "pending" || request.request_type !== "username") {
    return { success: false, error: "This request is no longer pending." };
  }

  if (request.user_type === "administrator" && callerType !== "owner") {
    return { success: false, error: "Only the Owner can approve an Administrator's request." };
  }

  const reviewer = getCurrentUser();

  if (!reviewer) {
    return { success: false, error: "Your session could not be verified. Please sign in again." };
  }

  const requestedUser = getUserById(request.user_id);

  if (!requestedUser) {
    return { success: false, error: "That account no longer exists." };
  }

  completePasswordResetRequest(requestId);

  insertPasswordResetAuditEvent(requestId, "completed", reviewer.id, `Username sent to ${requestedUser.full_name || requestedUser.username} via internal message by ${reviewer.full_name || reviewer.username}.`);

  sendSystemMessage(
    reviewer.id,
    reviewer.full_name || reviewer.username,
    requestedUser.id,
    "Your Username",
    `Your username recovery request has been approved. Your username is: ${requestedUser.username}`,
    "account_recovery"
  );

  return { success: true };

}

export async function redeemPasswordResetCode(
  username: string,
  resetCode: string,
  newPassword: string
): Promise<RedeemResetCodeResult> {

  const user = getUserByUsername(username.trim());

  if (!user) {
    return { success: false, error: "Invalid username or reset code." };
  }

  // Also flips any now-expired 'approved' request to 'expired' before
  // the lookup below, so an expired code is rejected here rather than
  // only at the next reviewer-side list refresh.
  const request = getActiveApprovedRequestForUser(user.id);

  if (!request || !request.reset_code_hash || request.reset_code_used_at) {
    return { success: false, error: "Invalid or expired reset code." };
  }

  const codeValid = await verifyPassword(resetCode.trim(), request.reset_code_hash);

  if (!codeValid) {
    return { success: false, error: "Invalid or expired reset code." };
  }

  if (!isPasswordStrongEnough(newPassword)) {
    return { success: false, error: "New password must be at least 8 characters." };
  }

  const newHash = await hashPassword(newPassword);

  // The user just proved (via the reset code) that they are the
  // legitimate account holder and chose this password themselves --
  // unlike an Administrator-issued temporary password, there is no
  // "must change on first login" step to force here.
  updatePasswordHash(user.id, newHash, false);

  // One-Time Reset Code: stamp reset_code_used_at and flip status to
  // 'completed' together -- getActiveApprovedRequestForUser only ever
  // matches status = 'approved', so this same code can never be
  // looked up (let alone re-verified) again, even if somehow re-typed.
  markPasswordResetCodeUsed(request.id);
  completePasswordResetRequest(request.id);

  insertPasswordResetAuditEvent(request.id, "completed", user.id, `Password reset completed by ${user.full_name || user.username}.`);

  return { success: true, user: toSafeUser(getUserById(user.id) as NonNullable<ReturnType<typeof getUserById>>) };

}

function requireReviewer(): "administrator" | "owner" {

  const callerType = getActiveSessionUserType();

  if (callerType !== "owner" && callerType !== "administrator") {
    throw new Error("You do not have access to Password Reset Requests.");
  }

  return callerType;

}
