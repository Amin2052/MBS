/**
 * MBS server-side permission contract.
 * UI visibility is not security: the online API must enforce these permissions too.
 */
export const MBS_ROLES = ["owner", "admin", "employee"] as const;
export type MbsRole = typeof MBS_ROLES[number];

export const MBS_PERMISSIONS = [
  "database.view",
  "database.add",
  "database.edit",
  "database.delete",
  "users.view",
  "users.add",
  "users.edit",
  "users.delete",
  "messages.view",
  "messages.add",
  "messages.edit",
  "messages.delete",
] as const;

export type MbsPermission = typeof MBS_PERMISSIONS[number];

const owner = new Set<MbsPermission>(MBS_PERMISSIONS);

const admin = new Set<MbsPermission>([
  "database.view", "database.add", "database.edit", "database.delete",
  "users.view", "users.add", "users.edit",
  "messages.view", "messages.add", "messages.edit", "messages.delete",
]);

const employee = new Set<MbsPermission>([
  "database.view", "database.add", "database.edit",
  "messages.view", "messages.add", "messages.edit", "messages.delete",
]);

export const ROLE_PERMISSIONS: Record<MbsRole, ReadonlySet<MbsPermission>> = {
  owner, admin, employee,
};

export function hasPermission(role: MbsRole, permission: MbsPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
