import { getDatabase } from "../database/database";
import type { PermissionKey } from "../auth/permission-catalog";

export type PermissionProfileRecord = {
  id: number;
  name: string;
  description: string;
  is_system: number;
  created_at: string;
  updated_at: string;
};

export function listPermissionProfiles(): PermissionProfileRecord[] {

  const db = getDatabase();

  return db
    .prepare(`SELECT * FROM permission_profiles ORDER BY is_system DESC, name ASC`)
    .all() as PermissionProfileRecord[];

}

export function getPermissionProfileById(id: number): PermissionProfileRecord | undefined {

  const db = getDatabase();

  return db
    .prepare(`SELECT * FROM permission_profiles WHERE id = ?`)
    .get(id) as PermissionProfileRecord | undefined;

}

export function getProfilePermissionKeys(profileId: number): PermissionKey[] {

  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT permission_key
      FROM profile_permissions
      WHERE profile_id = ?
        AND allowed = 1
    `)
    .all(profileId) as { permission_key: string }[];

  return rows.map(row => row.permission_key as PermissionKey);

}

export function createPermissionProfile(
  name: string,
  description: string,
  permissionKeys: PermissionKey[]
): PermissionProfileRecord {

  const db = getDatabase();

  const existing = db
    .prepare(`SELECT id FROM permission_profiles WHERE name = ?`)
    .get(name);

  if (existing) {
    throw new Error("A permission profile with that name already exists.");
  }

  const result = db
    .prepare(`
      INSERT INTO permission_profiles (name, description, is_system)
      VALUES (@name, @description, 0)
    `)
    .run({ name, description });

  const profileId = Number(result.lastInsertRowid);

  replaceProfilePermissions(profileId, permissionKeys);

  return getPermissionProfileById(profileId) as PermissionProfileRecord;

}

export function updatePermissionProfile(
  id: number,
  name: string,
  description: string,
  permissionKeys: PermissionKey[]
): PermissionProfileRecord {

  const db = getDatabase();

  const profile = getPermissionProfileById(id);

  if (!profile) {
    throw new Error("Permission profile not found.");
  }

  db.prepare(`
    UPDATE permission_profiles
    SET name = @name,
        description = @description,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id, name, description });

  replaceProfilePermissions(id, permissionKeys);

  return getPermissionProfileById(id) as PermissionProfileRecord;

}

function replaceProfilePermissions(profileId: number, permissionKeys: PermissionKey[]): void {

  const db = getDatabase();

  const deleteExisting = db.prepare(`DELETE FROM profile_permissions WHERE profile_id = ?`);
  const insert = db.prepare(`
    INSERT INTO profile_permissions (profile_id, permission_key, allowed)
    VALUES (@profile_id, @permission_key, 1)
  `);

  const transaction = db.transaction((keys: PermissionKey[]) => {

    deleteExisting.run(profileId);

    for (const key of keys) {
      insert.run({ profile_id: profileId, permission_key: key });
    }

  });

  transaction(permissionKeys);

}

export function deletePermissionProfile(id: number): void {

  const db = getDatabase();

  const profile = getPermissionProfileById(id);

  if (!profile) {
    throw new Error("Permission profile not found.");
  }

  if (profile.is_system) {
    throw new Error("System permission profiles cannot be deleted.");
  }

  const inUse = db
    .prepare(`SELECT id FROM users WHERE permission_profile_id = ? LIMIT 1`)
    .get(id);

  if (inUse) {
    throw new Error("This profile is assigned to one or more users and cannot be deleted.");
  }

  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM profile_permissions WHERE profile_id = ?`).run(id);
    db.prepare(`DELETE FROM permission_profiles WHERE id = ?`).run(id);
  });

  transaction();

}

/**
 * Resolves the final, flat permission set for a user: their assigned
 * profile's baseline grants, with any per-user overrides
 * (user_permissions) applied on top. This is what Phase 3's
 * navigation/module/button/action filtering will read via
 * AuthContext.hasPermission() -- Phase 2 only needs it for the
 * Permission Profile assignment UI, so it isn't wired into
 * permission-engine.ts's live evaluation path yet (still Owner-only
 * unrestricted access there, as designed in Phase 1).
 */
export function resolveUserPermissions(userId: number, profileId: number | null): Set<PermissionKey> {

  const db = getDatabase();

  const granted = new Set<PermissionKey>(
    profileId ? getProfilePermissionKeys(profileId) : []
  );

  const overrides = db
    .prepare(`
      SELECT permission_key, allowed
      FROM user_permissions
      WHERE user_id = ?
    `)
    .all(userId) as { permission_key: string; allowed: number }[];

  for (const override of overrides) {

    if (override.allowed) {
      granted.add(override.permission_key as PermissionKey);
    }
    else {
      granted.delete(override.permission_key as PermissionKey);
    }

  }

  return granted;

}
