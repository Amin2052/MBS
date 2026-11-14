/**
 * MBS security policy helpers.
 * Route handlers should apply these before authenticated mutations.
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ALLOWED_ROLES = new Set(["owner", "admin", "employee"]);

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

function isAllowedRole(role) {
  return ALLOWED_ROLES.has(role);
}

function isBodyWithinLimit(contentLength) {
  const n = Number(contentLength);
  return !Number.isFinite(n) || n <= MAX_BODY_BYTES;
}

function requireAuthenticatedUser(user) {
  if (!user || typeof user !== "object" || !user.id || !isAllowedRole(user.role)) {
    const error = new Error("Authentication required");
    error.code = "UNAUTHENTICATED";
    error.status = 401;
    throw error;
  }
  return user;
}

module.exports = {
  MAX_BODY_BYTES,
  securityHeaders,
  isAllowedRole,
  isBodyWithinLimit,
  requireAuthenticatedUser,
};
