/**
 * MBS server-side role authorization policy.
 * Framework agnostic: import `hasMbsPermission` from the actual route handlers.
 */
const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set([
    "database.view","database.add","database.edit","database.delete",
    "users.view","users.add","users.edit","users.delete",
    "messages.view","messages.add","messages.edit","messages.delete"
  ]),
  admin: new Set([
    "database.view","database.add","database.edit","database.delete",
    "users.view","users.add","users.edit",
    "messages.view","messages.add","messages.edit","messages.delete"
  ]),
  employee: new Set([
    "database.view","database.add","database.edit",
    "messages.view","messages.add","messages.edit","messages.delete"
  ])
});

function hasMbsPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.has(permission));
}

function assertMbsPermission(role, permission) {
  if (!hasMbsPermission(role, permission)) {
    const error = new Error("Forbidden");
    error.code = "FORBIDDEN";
    error.status = 403;
    throw error;
  }
}

module.exports = { ROLE_PERMISSIONS, hasMbsPermission, assertMbsPermission };
