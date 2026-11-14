import { getDatabase } from "../../../src/database/database";

// ===================================================================
// Security Policies
//
// Reuses company_settings (the same singleton-row pattern as Business
// Mode in Phase 1) and the users.failed_login_attempts / locked_until
// columns that were added, unused, back in Phase 1 specifically for
// this: "design the architecture so future features such as Session
// Timeout, Auto Lock... can be added without major refactoring."
// Only the Owner may change these values -- enforced by the IPC
// handler, same as Business Mode.
// ===================================================================

export interface SecurityPolicy {
  maxLoginAttempts: number;
  lockoutMinutes: number;
  /** Minutes of inactivity before the app auto-locks. 0 = disabled. */
  sessionTimeoutMinutes: number;
}

const DEFAULT_POLICY: SecurityPolicy = {
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  sessionTimeoutMinutes: 0
};

export function getSecurityPolicy(): SecurityPolicy {

  const db = getDatabase();

  const row = db
    .prepare(`
      SELECT security_max_login_attempts, security_lockout_minutes, security_session_timeout_minutes
      FROM company_settings
      WHERE id = 1
    `)
    .get() as { security_max_login_attempts: number; security_lockout_minutes: number; security_session_timeout_minutes: number } | undefined;

  if (!row) {
    return DEFAULT_POLICY;
  }

  return {
    maxLoginAttempts: row.security_max_login_attempts,
    lockoutMinutes: row.security_lockout_minutes,
    sessionTimeoutMinutes: row.security_session_timeout_minutes ?? 0
  };

}

export function setSecurityPolicy(policy: SecurityPolicy): void {

  if (
    !Number.isFinite(policy.maxLoginAttempts) || policy.maxLoginAttempts < 3 || policy.maxLoginAttempts > 20 ||
    !Number.isFinite(policy.lockoutMinutes) || policy.lockoutMinutes < 1 || policy.lockoutMinutes > 1440 ||
    !Number.isFinite(policy.sessionTimeoutMinutes) || policy.sessionTimeoutMinutes < 0 || policy.sessionTimeoutMinutes > 480
  ) {
    throw new Error("Invalid security policy values.");
  }

  const db = getDatabase();

  db.prepare(`
    UPDATE company_settings
    SET security_max_login_attempts = @maxLoginAttempts,
        security_lockout_minutes = @lockoutMinutes,
        security_session_timeout_minutes = @sessionTimeoutMinutes,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(policy);

}
