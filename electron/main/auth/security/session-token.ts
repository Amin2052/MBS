import crypto from "node:crypto";

// ===================================================================
// Session Tokens
//
// generateSessionToken() produces the raw, bearer-style secret that
// identifies a logged-in session. The raw token is only ever held in
// memory (auth-manager.ts's activeSession) and, for "Remember Me"
// sessions, encrypted at rest via Electron's OS-backed `safeStorage`
// (see ../session-storage.ts).
//
// hashSessionToken() is what actually goes into the `sessions` table
// -- same "never store the usable secret" principle as password
// hashing, so a copied/leaked database file alone can never be
// replayed as a working session.
// ===================================================================

export function generateSessionToken(): string {

  return crypto.randomBytes(32).toString("hex");

}

export function hashSessionToken(token: string): string {

  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

}
