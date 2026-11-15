import {
  ownerExists,
  getUserByUsername,
  getUserById,
  createOwnerAccount,
  updateLastLogin,
  recordFailedLoginAttempt,
  lockUserUntil,
  updatePasswordHash,
  setRecoveryKeyHash,
  isUsernameTaken,
  updateUsername,
  updateUserProfileFields,
  saveUserPhoto,
  removeUserPhoto,
  getUserPhotoDataUrl,
  toSafeUser,
  type SafeUser
} from "../../../src/repositories/user-repository";

import {
  createSession,
  findValidSessionByTokenHash,
  touchSession,
  revokeSessionByTokenHash
} from "../../../src/repositories/session-repository";

import { hashPassword, verifyPassword, isPasswordStrongEnough, generateRecoveryKey } from "./security/password";
import { generateSessionToken, hashSessionToken } from "./security/session-token";

import {
  persistRememberMeToken,
  readRememberMeToken,
  clearRememberMeToken
} from "./session-storage";

import { getSecurityPolicy } from "./security-policy-service";

// ===================================================================
// Auth Manager
//
// Mirrors LicenseManager's role for licensing: the single main-
// process authority for "who is logged in right now". IPC handlers in
// main.ts call this module; nothing else touches user-repository.ts,
// session-repository.ts, or the security/ helpers directly.
//
// `activeSession` is this running app instance's current session --
// separate from the `sessions` table row, which is the durable record
// (needed for Remember Me to survive a restart, and as the foundation
// future features like Multi-Session Control/Session Management will
// build on). One Electron app instance == one active session, which
// matches the desktop, single-window nature of this app; nothing here
// assumes that will always be true, so it can grow into real
// multi-session tracking later without a redesign.
// ===================================================================

type ActiveSession = {
  sessionId: number;
  userId: number;
  tokenHash: string;
};

let activeSession: ActiveSession | null = null;

export interface AuthResult {
  success: boolean;
  user?: SafeUser;
  error?: string;
  // Only ever populated by setupOwnerAccount, and only that one time --
  // the plaintext Recovery Key is never retrievable again afterward.
  recoveryKey?: string;
}

function normalizeUsername(username: string): string {

  return username.trim();

}

export function checkSetupRequired(): boolean {

  return !ownerExists();

}

export async function setupOwnerAccount(
  username: string,
  password: string
): Promise<AuthResult> {

  if (ownerExists()) {
    return { success: false, error: "The Owner account has already been set up." };
  }

  const normalizedUsername = normalizeUsername(username);

  if (normalizedUsername.length < 3) {
    return { success: false, error: "Username must be at least 3 characters." };
  }

  if (!isPasswordStrongEnough(password)) {
    return { success: false, error: "Password must be at least 8 characters." };
  }

  if (getUserByUsername(normalizedUsername)) {
    return { success: false, error: "That username is already taken." };
  }

  const passwordHash = await hashPassword(password);

  const user = createOwnerAccount(normalizedUsername, passwordHash);

  // Recovery Key (Task 2): generated once, right alongside the Owner's
  // own credentials, since this is the only account with no
  // Administrator/Owner above it to approve a Forgot Password request.
  // Only the hash is persisted -- the plaintext key is returned here
  // and never retrievable again, so the renderer must show it to the
  // Owner immediately (same "save this now" pattern as a freshly
  // created Administrator/Employee's temporary password).
  const recoveryKey = generateRecoveryKey();
  const recoveryKeyHash = await hashPassword(recoveryKey);

  setRecoveryKeyHash(user.id, recoveryKeyHash);

  // The Owner just proved they set these credentials themselves --
  // establish an in-memory session immediately so Setup flows straight
  // into the app, exactly like Login would. Not persisted as a
  // Remember Me session unless they later log out and back in with
  // that option checked.
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const sessionRow = createSession(user.id, tokenHash, false);

  activeSession = {
    sessionId: sessionRow.id,
    userId: user.id,
    tokenHash
  };

  updateLastLogin(user.id);

  return {
    success: true,
    user: toSafeUser(getUserById(user.id) as typeof user),
    recoveryKey
  };

}

export async function login(
  username: string,
  password: string,
  rememberMe: boolean
): Promise<AuthResult> {

  const normalizedUsername = normalizeUsername(username);

  const user = getUserByUsername(normalizedUsername);

  if (!user) {
    return { success: false, error: "Invalid username or password." };
  }

  if (user.status !== "active") {
    return { success: false, error: "This account is disabled. Contact your administrator." };
  }

  // Security Policies (Phase 5): account lockout after too many
  // consecutive failed attempts. Never applies to the Owner -- an
  // Owner lockout with no Administrator to unlock them would be a
  // permanent, unrecoverable lockout of the entire ERP.
  if (user.user_type !== "owner" && user.locked_until) {

    const lockedUntil = new Date(user.locked_until).getTime();

    if (lockedUntil > Date.now()) {

      const minutesRemaining = Math.ceil((lockedUntil - Date.now()) / 60000);

      return {
        success: false,
        error: `Too many failed attempts. Try again in ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.`
      };

    }

  }

  const passwordValid = await verifyPassword(password, user.password_hash);

  if (!passwordValid) {

    recordFailedLoginAttempt(user.id);

    if (user.user_type !== "owner") {

      const policy = getSecurityPolicy();

      // failed_login_attempts hasn't been re-read since the increment
      // above, so +1 accounts for the attempt that just failed.
      if (user.failed_login_attempts + 1 >= policy.maxLoginAttempts) {

        const lockedUntil = new Date(Date.now() + policy.lockoutMinutes * 60000).toISOString();

        lockUserUntil(user.id, lockedUntil);

      }

    }

    return { success: false, error: "Invalid username or password." };

  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const sessionRow = createSession(user.id, tokenHash, rememberMe);

  activeSession = {
    sessionId: sessionRow.id,
    userId: user.id,
    tokenHash
  };

  updateLastLogin(user.id);

  if (rememberMe) {
    persistRememberMeToken(token);
  }
  else {
    // Explicitly clear any previously remembered session for this
    // device -- logging in without Remember Me means "don't keep me
    // signed in", which should override whatever was persisted before.
    clearRememberMeToken();
  }

  return { success: true, user: toSafeUser(getUserById(user.id) as typeof user) };

}

export function logout(): { success: true } {

  if (activeSession) {
    revokeSessionByTokenHash(activeSession.tokenHash);
  }

  // Logout always ends the persisted Remember Me session too -- it is
  // an explicit "sign me out" action and must not silently sign the
  // user back in on next launch.
  clearRememberMeToken();

  activeSession = null;

  return { success: true };

}

/**
 * Called once at app startup. Attempts to restore a Remember Me
 * session from the encrypted local session file; returns the user if
 * (and only if) a matching, still-valid, non-revoked session exists.
 */
export function restoreSession(): { user: SafeUser } | null {

  const token = readRememberMeToken();

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);

  const sessionRow = findValidSessionByTokenHash(tokenHash);

  if (!sessionRow || !sessionRow.remember_me) {
    clearRememberMeToken();
    return null;
  }

  const user = getUserById(sessionRow.user_id);

  if (!user || user.status !== "active") {
    clearRememberMeToken();
    return null;
  }

  activeSession = {
    sessionId: sessionRow.id,
    userId: user.id,
    tokenHash
  };

  touchSession(sessionRow.id);

  return { user: toSafeUser(user) };

}

export function getCurrentUser(): SafeUser | null {

  if (!activeSession) {
    return null;
  }

  const user = getUserById(activeSession.userId);

  return user ? toSafeUser(user) : null;

}

/**
 * Returns the currently authenticated user's full record (including
 * user_type) for other main-process modules that need to authorize an
 * action -- e.g. the businessMode:set IPC handler confirming the
 * caller is actually the Owner before changing it. Deliberately not
 * exported alongside SafeUser helpers above: this is for main-process
 * authorization checks only, never sent to the renderer as-is.
 */
export function getActiveSessionUserType(): "owner" | "administrator" | "employee" | null {

  if (!activeSession) {
    return null;
  }

  const user = getUserById(activeSession.userId);

  return user?.user_type ?? null;

}

/**
 * Re-authenticates the CURRENT session's user against a password typed into
 * a destructive-operation dialog. Deliberately not a new login: it never
 * creates a session, never changes the active user, and returns a boolean.
 * The only thing a caller may do with it is gate an already-authorized
 * action (the cloud/complete reset handlers in main.ts) -- changePassword()
 * would be wrong here because it mutates the password, and the recovery-key
 * flow is a different threat model entirely.
 */
export async function verifyActiveUserPassword(password: string): Promise<boolean> {

  if (!activeSession || typeof password !== "string" || !password) {
    return false;
  }

  const user = getUserById(activeSession.userId);

  if (!user) {
    return false;
  }

  return verifyPassword(password, user.password_hash);

}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<AuthResult> {

  if (!activeSession) {
    return { success: false, error: "You must be logged in to change your password." };
  }

  const user = getUserById(activeSession.userId);

  if (!user) {
    return { success: false, error: "User not found." };
  }

  const currentValid = await verifyPassword(currentPassword, user.password_hash);

  if (!currentValid) {
    return { success: false, error: "Current password is incorrect." };
  }

  if (!isPasswordStrongEnough(newPassword)) {
    return { success: false, error: "New password must be at least 8 characters." };
  }

  const newHash = await hashPassword(newPassword);

  updatePasswordHash(user.id, newHash, false);

  return { success: true, user: toSafeUser(getUserById(user.id) as typeof user) };

}

/**
 * Edit Profile: renames the logged-in user's own username. Deliberately
 * narrow -- SafeUser has no other self-editable fields today (see
 * user-repository.ts) -- and mirrors changePassword's shape directly
 * above: require an active session, validate, write, return the
 * refreshed SafeUser.
 */
/**
 * Edit Profile. Persists username plus the rest of the expanded
 * profile form (full name/email/phone, and -- only when the caller
 * has already been authorized one layer up, in main.ts's IPC handler
 * -- designation). Same shape as changePassword directly above:
 * require an active session, validate, write, return the refreshed
 * SafeUser so the renderer (and Topbar, via AuthContext) picks up the
 * new values immediately.
 */
export interface UpdateProfileInput {
  username: string;
  fullName?: string;
  email?: string;
  phone?: string;
  /** Only ever set by main.ts after it has verified the caller is Owner/employees.edit-permitted. */
  designation?: string;
}

export async function updateProfile(input: UpdateProfileInput): Promise<AuthResult> {

  if (!activeSession) {
    return { success: false, error: "You must be logged in to update your profile." };
  }

  const trimmed = input.username.trim();

  if (!trimmed) {
    return { success: false, error: "Username cannot be empty." };
  }

  const user = getUserById(activeSession.userId);

  if (!user) {
    return { success: false, error: "User not found." };
  }

  if (trimmed !== user.username && isUsernameTaken(trimmed)) {
    return { success: false, error: "That username is already taken." };
  }

  updateUsername(user.id, trimmed);

  updateUserProfileFields(user.id, {
    ...(input.fullName !== undefined ? { full_name: input.fullName.trim() } : {}),
    ...(input.email !== undefined ? { email: input.email.trim() } : {}),
    ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
    ...(input.designation !== undefined ? { designation: input.designation.trim() } : {})
  });

  return { success: true, user: toSafeUser(getUserById(user.id) as typeof user) };

}

/**
 * Profile Picture (own account). Same "require an active session"
 * guard as updateProfile/changePassword above -- decoding the picked
 * file's data URL back into bytes happens one layer up, in main.ts's
 * IPC handler, the same split employees:update uses for
 * decodePhotoDataUrl.
 */
export function getMyProfilePhoto(): string | null {

  if (!activeSession) {
    return null;
  }

  return getUserPhotoDataUrl(activeSession.userId);

}

export function saveMyProfilePhoto(buffer: Buffer, mime: string): { success: boolean } {

  if (!activeSession) {
    return { success: false };
  }

  saveUserPhoto(activeSession.userId, buffer, mime);

  return { success: true };

}

export function removeMyProfilePhoto(): { success: boolean } {

  if (!activeSession) {
    return { success: false };
  }

  removeUserPhoto(activeSession.userId);

  return { success: true };

}

/**
 * Owner Recovery Key flow (Task 2). Deliberately separate from the
 * Employee/Administrator Forgot Password flow -- there is no approval
 * step, and it can never be triggered or fulfilled by an Administrator,
 * per spec ("Administrator must NEVER be able to reset the Owner
 * account"). Runs with no active session, same as login(): the Owner
 * is, by definition, locked out right now.
 */
export async function verifyOwnerRecoveryKey(
  username: string,
  recoveryKey: string
): Promise<{ success: boolean; error?: string }> {

  const user = getUserByUsername(normalizeUsername(username));

  if (!user || user.user_type !== "owner" || !user.recovery_key_hash) {
    return { success: false, error: "Invalid username or Recovery Key." };
  }

  const valid = await verifyPassword(recoveryKey.trim(), user.recovery_key_hash);

  if (!valid) {
    return { success: false, error: "Invalid username or Recovery Key." };
  }

  return { success: true };

}

export async function resetOwnerPasswordWithRecoveryKey(
  username: string,
  recoveryKey: string,
  newPassword: string
): Promise<AuthResult> {

  const verification = await verifyOwnerRecoveryKey(username, recoveryKey);

  if (!verification.success) {
    return { success: false, error: verification.error };
  }

  if (!isPasswordStrongEnough(newPassword)) {
    return { success: false, error: "New password must be at least 8 characters." };
  }

  const user = getUserByUsername(normalizeUsername(username));

  if (!user) {
    return { success: false, error: "User not found." };
  }

  const newHash = await hashPassword(newPassword);

  updatePasswordHash(user.id, newHash, false);

  // Rotate the Recovery Key on every successful use -- the key that
  // was just typed in has now been seen by whoever was present for
  // this recovery, so it must never work again. The Owner is shown
  // this new key exactly once, the same as during First-Time Setup.
  const newRecoveryKey = generateRecoveryKey();
  const newRecoveryKeyHash = await hashPassword(newRecoveryKey);

  setRecoveryKeyHash(user.id, newRecoveryKeyHash);

  return {
    success: true,
    user: toSafeUser(getUserById(user.id) as typeof user),
    recoveryKey: newRecoveryKey
  };

}
