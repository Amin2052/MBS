import type { PermissionKey } from "@/auth/permission-catalog";

export interface AuthContextValue {

  /** True only while the initial startup bootstrap (setup check + Remember Me restore) hasn't resolved yet. */
  loading: boolean;

  /** True when no Owner account exists yet -- the First-Time Setup Wizard must be shown. */
  setupRequired: boolean;

  /** Null when nobody is logged in (Setup Wizard or Login screen is showing). */
  user: SafeUser | null;

  /**
   * Set for exactly one render cycle right after Owner setup succeeds --
   * the plaintext Recovery Key that must be shown to the Owner before
   * AuthGate is allowed to fall through to the app. See
   * RecoveryKeyRevealScreen / acknowledgeRecoveryKey.
   */
  pendingRecoveryKey: string | null;

  /** Dismisses pendingRecoveryKey once the Owner has confirmed they saved it. */
  acknowledgeRecoveryKey: () => void;

  /** Company-wide Business Mode (Starter/Enterprise). Null only before the first successful load. */
  businessMode: BusinessMode | null;

  /** Re-reads Business Mode from the database (e.g. after the Owner changes it). */
  refreshBusinessMode: () => Promise<void>;

  /** Creates the Owner account (First-Time Setup Wizard) and logs them in. */
  completeSetup: (username: string, password: string) => Promise<{ success: boolean; error?: string; recoveryKey?: string }>;

  /** Logs in with username/password; optionally persists a Remember Me session. */
  login: (username: string, password: string, rememberMe: boolean) => Promise<{ success: boolean; error?: string }>;

  /** Ends the current session (and any Remember Me persistence), returning to the Login screen. */
  logout: () => Promise<void>;

  /**
   * Central permission check -- never compare user.user_type directly
   * against "admin" anywhere else in the app. See src/auth/
   * permission-engine.ts. Phase 1: always true for the Owner, always
   * false for anyone else (no Administrator/Employee accounts exist
   * yet in Phase 1, and Phase 2/3 wire up real evaluation).
   */
  hasPermission: (permissionKey: PermissionKey) => boolean;

  /** Changes the current user's password after verifying their current one. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;

  /** Updates the current user's own editable profile fields (Edit Profile). designation is only actually applied server-side if the caller is Owner or holds employees.edit. */
  updateProfile: (data: { username: string; fullName?: string; email?: string; phone?: string; designation?: string }) => Promise<{ success: boolean; error?: string }>;

  /** Re-fetches the current user from the main process (e.g. after an external change). */
  refreshSession: () => Promise<void>;

}
