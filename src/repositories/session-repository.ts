import { getDatabase } from "../database/database";

export type SessionRecord = {
  id: number;
  user_id: number;
  token_hash: string;
  remember_me: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string;
  revoked_at: string | null;
};

export function createSession(
  userId: number,
  tokenHash: string,
  rememberMe: boolean
): SessionRecord {

  const db = getDatabase();

  // Remember Me sessions previously never expired on their own (only
  // explicit logout/revoke ended them) -- a session persisted to disk
  // that's valid forever is a real exposure if a device is lost or
  // shared. Non-Remember-Me sessions stay expires_at = NULL since they
  // aren't persisted across restarts anyway (restoreSession() only
  // ever looks at Remember Me tokens), so there's nothing to bound.
  const REMEMBER_ME_SESSION_DAYS = 30;

  const expiresAt = rememberMe
    ? new Date(Date.now() + REMEMBER_ME_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const result = db
    .prepare(`
      INSERT INTO sessions
      (user_id, token_hash, remember_me, expires_at)
      VALUES (@user_id, @token_hash, @remember_me, @expires_at)
    `)
    .run({
      user_id: userId,
      token_hash: tokenHash,
      remember_me: rememberMe ? 1 : 0,
      expires_at: expiresAt
    });

  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(result.lastInsertRowid) as SessionRecord;

}

/**
 * Looks up a session by its token hash, but only returns it if the
 * session is still valid: not revoked, and (once Phase 5 starts
 * populating expires_at) not expired. Used both by login-session
 * refresh and by Remember Me restoration on startup.
 */
export function findValidSessionByTokenHash(
  tokenHash: string
): SessionRecord | undefined {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM sessions
      WHERE token_hash = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `)
    .get(tokenHash) as SessionRecord | undefined;

}

export function touchSession(sessionId: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE sessions
    SET last_used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sessionId);

}

export function revokeSession(sessionId: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sessionId);

}

export function revokeSessionByTokenHash(tokenHash: string): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE token_hash = ?
  `).run(tokenHash);

}

export type ActiveSessionWithUser = SessionRecord & {
  username: string;
  user_type: string;
};

/** Lists every currently-valid (not revoked, not expired) session,
 *  joined with the owning user's username/type, for the Active
 *  Sessions viewer in Security Settings (Phase 8). */
export function listActiveSessions(): ActiveSessionWithUser[] {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT s.*, u.username, u.user_type
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
      ORDER BY s.last_used_at DESC
    `)
    .all() as ActiveSessionWithUser[];

}
