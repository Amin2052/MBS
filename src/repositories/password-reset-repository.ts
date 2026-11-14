import { getDatabase } from "../database/database";

// ===================================================================
// Password Reset Requests Repository
//
// Backs the Forgot Password Workflow (Task 2): Employee -> reviewed by
// Administrator, Administrator -> reviewed by Owner. Follows the same
// thin repository pattern as user-repository.ts / session-repository.ts
// -- plain prepared statements, no business logic (authorization and
// code generation live in electron/main/auth/password-reset-manager.ts).
// The Owner never has rows here -- Owner recovery is the separate
// Recovery Key flow.
// ===================================================================

export type PasswordResetRequestStatus = "pending" | "approved" | "completed" | "cancelled" | "expired";

export type PasswordResetRequestUserType = "employee" | "administrator";

/**
 * Which recovery flow this row belongs to -- 'password' keeps the
 * existing generate-a-code / redeem-it-yourself workflow below;
 * 'username' is resolved directly (there is no password to redeem,
 * only an existing username to reveal) -- see
 * approveUsernameRecoveryRequest in password-reset-manager.ts.
 */
export type PasswordResetRequestType = "password" | "username";

export type PasswordResetRequestRecord = {
  id: number;
  user_id: number;
  user_type: PasswordResetRequestUserType;
  status: PasswordResetRequestStatus;
  request_type: PasswordResetRequestType;
  reset_code_hash: string | null;
  // Unix timestamp (seconds since epoch), NOT an ISO string. SQLite's
  // CURRENT_TIMESTAMP produces "YYYY-MM-DD HH:MM:SS" while
  // `new Date().toISOString()` produces "YYYY-MM-DDTHH:MM:SS.sssZ" --
  // comparing the two as strings is broken (the 'T' separator sorts
  // after a space, so an ISO string almost always compares as
  // "greater than" CURRENT_TIMESTAMP regardless of actual time,
  // meaning expired codes were never reliably caught). Storing a
  // plain integer and comparing against a JS-computed Unix timestamp
  // side-steps string/format comparison entirely. The column keeps
  // its existing DATETIME declaration (SQLite's NUMERIC type
  // affinity stores an integer value losslessly either way), so no
  // schema migration is required.
  reset_code_expires_at: number | null;
  reset_code_used_at: string | null;
  reviewed_by: number | null;
  created_at: string;
  resolved_at: string | null;
};

export type PasswordResetRequestWithUsername = PasswordResetRequestRecord & {
  username: string;
  full_name: string | null;
  reviewed_by_username: string | null;
  reviewed_by_full_name: string | null;
};

/**
 * Creates a new pending request, unless the user already has one
 * pending -- Forgot Password can be clicked more than once without
 * piling up duplicate rows for the same reviewer to work through.
 */
export function createPasswordResetRequest(
  userId: number,
  userType: PasswordResetRequestUserType,
  requestType: PasswordResetRequestType = "password"
): PasswordResetRequestRecord {

  const db = getDatabase();

  const existing = getPendingRequestForUser(userId, requestType);

  if (existing) {
    return existing;
  }

  const result = db
    .prepare(`
      INSERT INTO password_reset_requests
      (
        user_id,
        user_type,
        status,
        request_type
      )
      VALUES
      (
        @user_id,
        @user_type,
        'pending',
        @request_type
      )
    `)
    .run({ user_id: userId, user_type: userType, request_type: requestType });

  return getPasswordResetRequestById(Number(result.lastInsertRowid)) as PasswordResetRequestRecord;

}

export function getPasswordResetRequestById(id: number): PasswordResetRequestRecord | undefined {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM password_reset_requests
      WHERE id = ?
    `)
    .get(id) as PasswordResetRequestRecord | undefined;

}

export function getPendingRequestForUser(
  userId: number,
  requestType: PasswordResetRequestType = "password"
): PasswordResetRequestRecord | undefined {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM password_reset_requests
      WHERE user_id = ? AND status = 'pending' AND request_type = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(userId, requestType) as PasswordResetRequestRecord | undefined;

}

/**
 * The most recent still-usable (approved, not yet expired) request for
 * a user -- what redeemPasswordResetCode checks the entered code
 * against. Callers must still verify the code hash themselves; this
 * only narrows down which row to check it against.
 */
export function getActiveApprovedRequestForUser(userId: number): PasswordResetRequestRecord | undefined {

  expireStalePasswordResetRequests();

  const db = getDatabase();

  const nowUnixSeconds = Math.floor(Date.now() / 1000);

  return db
    .prepare(`
      SELECT *
      FROM password_reset_requests
      WHERE user_id = ?
        AND status = 'approved'
        AND reset_code_used_at IS NULL
        AND reset_code_expires_at IS NOT NULL
        AND reset_code_expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(userId, nowUnixSeconds) as PasswordResetRequestRecord | undefined;

}

/**
 * Lists pending requests a given reviewer type may act on, joined with
 * the requester's username for display. Administrators review Employee
 * requests; the Owner reviews Administrator requests (and, since the
 * Owner has unrestricted access, Employee requests too).
 */
export function listPendingRequestsForReviewer(
  reviewerType: "administrator" | "owner"
): PasswordResetRequestWithUsername[] {

  expireStalePasswordResetRequests();

  const db = getDatabase();

  const userTypes: PasswordResetRequestUserType[] =
    reviewerType === "owner" ? ["employee", "administrator"] : ["employee"];

  const placeholders = userTypes.map(() => "?").join(", ");

  return db
    .prepare(`
      SELECT
        prr.*,
        u.username AS username,
        u.full_name AS full_name,
        reviewer.username AS reviewed_by_username,
        reviewer.full_name AS reviewed_by_full_name
      FROM password_reset_requests prr
      JOIN users u ON u.id = prr.user_id
      LEFT JOIN users reviewer ON reviewer.id = prr.reviewed_by
      WHERE prr.status = 'pending'
        AND prr.user_type IN (${placeholders})
      ORDER BY prr.created_at ASC
    `)
    .all(...userTypes) as PasswordResetRequestWithUsername[];

}

export function approvePasswordResetRequest(
  id: number,
  resetCodeHash: string,
  expiresAtUnixSeconds: number,
  reviewedBy: number
): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE password_reset_requests
    SET status = 'approved',
        reset_code_hash = @reset_code_hash,
        reset_code_expires_at = @reset_code_expires_at,
        reviewed_by = @reviewed_by
    WHERE id = @id
  `).run({
    id,
    reset_code_hash: resetCodeHash,
    reset_code_expires_at: expiresAtUnixSeconds,
    reviewed_by: reviewedBy
  });

}

/**
 * Flips any 'approved' request whose code has passed its expiry into
 * 'expired' -- called before every read so status is always accurate
 * without needing a background timer. Idempotent; audit-logs the
 * transition once per request.
 */
export function expireStalePasswordResetRequests(): void {

  const db = getDatabase();

  const nowUnixSeconds = Math.floor(Date.now() / 1000);

  const staleRows = db
    .prepare(`
      SELECT id
      FROM password_reset_requests
      WHERE status = 'approved'
        AND reset_code_expires_at IS NOT NULL
        AND reset_code_expires_at <= ?
    `)
    .all(nowUnixSeconds) as { id: number }[];

  if (staleRows.length === 0) {
    return;
  }

  const markExpired = db.prepare(`
    UPDATE password_reset_requests
    SET status = 'expired'
    WHERE id = ?
  `);

  for (const row of staleRows) {
    markExpired.run(row.id);
    insertPasswordResetAuditEvent(row.id, "expired", null, "Reset code expired unused.");
  }

}

export function markPasswordResetCodeUsed(id: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE password_reset_requests
    SET reset_code_used_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id });

}

export function completePasswordResetRequest(id: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE password_reset_requests
    SET status = 'completed',
        resolved_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id });

}

/**
 * Full history (all statuses, all time) for a reviewer -- same
 * user_type scoping as listPendingRequestsForReviewer, since an
 * Administrator should never see an Administrator-level request's
 * history either.
 */
export function listRequestHistoryForReviewer(
  reviewerType: "administrator" | "owner"
): PasswordResetRequestWithUsername[] {

  expireStalePasswordResetRequests();

  const db = getDatabase();

  const userTypes: PasswordResetRequestUserType[] =
    reviewerType === "owner" ? ["employee", "administrator"] : ["employee"];

  const placeholders = userTypes.map(() => "?").join(", ");

  return db
    .prepare(`
      SELECT
        prr.*,
        u.username AS username,
        u.full_name AS full_name,
        reviewer.username AS reviewed_by_username,
        reviewer.full_name AS reviewed_by_full_name
      FROM password_reset_requests prr
      JOIN users u ON u.id = prr.user_id
      LEFT JOIN users reviewer ON reviewer.id = prr.reviewed_by
      WHERE prr.user_type IN (${placeholders})
      ORDER BY prr.created_at DESC
    `)
    .all(...userTypes) as PasswordResetRequestWithUsername[];

}

// --------------------------
// Audit Log
// --------------------------

export type PasswordResetAuditEvent =
  | "requested"
  | "approved"
  | "completed"
  | "expired"
  | "cancelled";

export type PasswordResetAuditLogRecord = {
  id: number;
  request_id: number;
  event: PasswordResetAuditEvent;
  actor_user_id: number | null;
  detail: string | null;
  created_at: string;
};

export function insertPasswordResetAuditEvent(
  requestId: number,
  event: PasswordResetAuditEvent,
  actorUserId: number | null,
  detail?: string
): void {

  const db = getDatabase();

  db.prepare(`
    INSERT INTO password_reset_audit_log
    (
      request_id,
      event,
      actor_user_id,
      detail
    )
    VALUES
    (
      @request_id,
      @event,
      @actor_user_id,
      @detail
    )
  `).run({
    request_id: requestId,
    event,
    actor_user_id: actorUserId,
    detail: detail ?? null
  });

}

export function listAuditLogForRequest(requestId: number): PasswordResetAuditLogRecord[] {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM password_reset_audit_log
      WHERE request_id = ?
      ORDER BY created_at ASC
    `)
    .all(requestId) as PasswordResetAuditLogRecord[];

}
