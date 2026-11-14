import { getDatabase } from "../database/database";

export type UserType = "owner" | "administrator" | "employee";
export type UserStatus = "active" | "disabled" | "archived";

export type UserRecord = {
  id: number;
  user_type: UserType;
  username: string;
  password_hash: string;
  must_change_password: number;
  status: UserStatus;
  employee_id: number | null;
  permission_profile_id: number | null;
  created_by: number | null;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  recovery_key_hash: string | null;
  photo_blob: Buffer | null;
  photo_mime: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
};

/** UserRecord with password_hash/recovery_key_hash/photo_blob/photo_mime stripped -- what the renderer is ever allowed to see via getCurrentUser()/session-restore. Photo bytes are fetched separately (getUserPhotoDataUrl), only for the current user's own profile page. */
export type SafeUser = Omit<UserRecord, "password_hash" | "recovery_key_hash" | "photo_blob" | "photo_mime">;

export function toSafeUser(user: UserRecord): SafeUser {

  const { password_hash, recovery_key_hash, photo_blob, photo_mime, ...safeUser } = user;

  void password_hash;
  void recovery_key_hash;
  void photo_blob;
  void photo_mime;

  return safeUser;

}

export function ownerExists(): boolean {

  const db = getDatabase();

  const row = db
    .prepare(`
      SELECT id
      FROM users
      WHERE user_type = 'owner'
      LIMIT 1
    `)
    .get();

  return row !== undefined;

}

export function getUserByUsername(username: string): UserRecord | undefined {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM users
      WHERE username = ?
    `)
    .get(username) as UserRecord | undefined;

}

export function getUserById(id: number): UserRecord | undefined {

  const db = getDatabase();

  return db
    .prepare(`
      SELECT *
      FROM users
      WHERE id = ?
    `)
    .get(id) as UserRecord | undefined;

}

/**
 * Creates the single Owner account. Only ever called from the
 * First-Time Setup Wizard. Guarded at two levels: this application-
 * level check (for a clean, specific error message) and the
 * idx_users_single_owner partial unique index in the schema (the
 * actual hard guarantee -- see database.ts).
 */
export function createOwnerAccount(
  username: string,
  passwordHash: string
): UserRecord {

  const db = getDatabase();

  if (ownerExists()) {
    throw new Error("An Owner account already exists.");
  }

  const result = db
    .prepare(`
      INSERT INTO users
      (
        user_type,
        username,
        password_hash,
        must_change_password,
        status
      )
      VALUES
      (
        'owner',
        @username,
        @password_hash,
        0,
        'active'
      )
    `)
    .run({
      username,
      password_hash: passwordHash
    });

  return getUserById(Number(result.lastInsertRowid)) as UserRecord;

}

export function updateLastLogin(userId: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP,
        failed_login_attempts = 0,
        locked_until = NULL
    WHERE id = ?
  `).run(userId);

}

export function recordFailedLoginAttempt(userId: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(userId);

}

export function lockUserUntil(userId: number, lockedUntilIso: string): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET locked_until = @locked_until,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: userId, locked_until: lockedUntilIso });

}

export function generateNextUsername(prefix: "EMP" | "ADM"): string {

  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT username
      FROM users
      WHERE username LIKE ?
    `)
    .all(`${prefix}%`) as { username: string }[];

  let maxSequence = 0;

  const pattern = new RegExp(`^${prefix}(\\d{6})$`);

  for (const row of rows) {

    const match = row.username.match(pattern);

    if (match) {
      maxSequence = Math.max(maxSequence, Number(match[1]));
    }

  }

  const nextSequence = maxSequence + 1;

  return `${prefix}${String(nextSequence).padStart(6, "0")}`;

}

export type CreateUserInput = {
  user_type: "administrator" | "employee";
  username: string;
  password_hash: string;
  employee_id: number | null;
  permission_profile_id: number | null;
  created_by: number | null;
};

export function createUser(input: CreateUserInput): UserRecord {

  const db = getDatabase();

  const result = db
    .prepare(`
      INSERT INTO users
      (
        user_type,
        username,
        password_hash,
        must_change_password,
        status,
        employee_id,
        permission_profile_id,
        created_by
      )
      VALUES
      (
        @user_type,
        @username,
        @password_hash,
        1,
        'active',
        @employee_id,
        @permission_profile_id,
        @created_by
      )
    `)
    .run(input);

  return getUserById(Number(result.lastInsertRowid)) as UserRecord;

}

/**
 * Generates the next sequential username for the given prefix and
 * inserts the new user row in a single database transaction, so two
 * overlapping account-creation calls can never both read the same
 * "next" sequence number before either row is committed (the account
 * creation IPC handlers are otherwise fully synchronous once they
 * reach this point, but this closes the gap unconditionally rather
 * than relying on that).
 */
export function createUserWithGeneratedUsername(
  prefix: "EMP" | "ADM",
  input: Omit<CreateUserInput, "username">
): UserRecord {

  const db = getDatabase();

  const run = db.transaction(() => {

    const username = generateNextUsername(prefix);

    return createUser({ ...input, username });

  });

  return run();

}

export type UserWithEmployee = SafeUser & {
  employee_first_name: string | null;
  employee_last_name: string | null;
  employee_number: string | null;
  employee_department: string | null;
  employee_designation: string | null;
  permission_profile_name: string | null;
};

/**
 * Lists every user (Owner, Administrators, Employees) joined with
 * their linked employee's name (if any) and permission profile name
 * (if any), for the User Management table. Ordered so the Owner
 * always appears first, then by most recently created.
 */
export function listUsers(): UserWithEmployee[] {

  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT
        u.*,
        e.first_name AS employee_first_name,
        e.last_name AS employee_last_name,
        e.employee_number AS employee_number,
        e.department AS employee_department,
        e.designation AS employee_designation,
        pp.name AS permission_profile_name
      FROM users u
      LEFT JOIN employees e ON e.id = u.employee_id
      LEFT JOIN permission_profiles pp ON pp.id = u.permission_profile_id
      ORDER BY
        CASE u.user_type WHEN 'owner' THEN 0 ELSE 1 END,
        u.created_at DESC
    `)
    .all() as (UserRecord & {
      employee_first_name: string | null;
      employee_last_name: string | null;
      employee_number: string | null;
      employee_department: string | null;
      employee_designation: string | null;
      permission_profile_name: string | null;
    })[];

  return rows.map(row => {

    const { password_hash, recovery_key_hash, ...rest } = row;

    void password_hash;
    void recovery_key_hash;

    return rest;

  });

}

export type UserLifecycleStatus = "active" | "disabled" | "archived";

/**
 * Transitions a user's status. Used for Disable, Archive, and Restore
 * -- Restore is simply this function called with 'active' from either
 * 'disabled' or 'archived'. The Owner account can never be targeted --
 * enforced both here and again by the IPC handler's authorization
 * check in main.ts (defense in depth).
 */
export function setUserStatus(userId: number, status: UserLifecycleStatus): void {

  const db = getDatabase();

  const target = getUserById(userId);

  if (!target) {
    throw new Error("User not found.");
  }

  if (target.user_type === "owner") {
    throw new Error("The Owner account cannot be disabled, archived, or restored.");
  }

  db.prepare(`
    UPDATE users
    SET status = @status,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: userId, status });

}

export function isUsernameTaken(username: string): boolean {

  return getUserByUsername(username) !== undefined;

}

/**
 * Reassigns an Employee's permission profile after their account already
 * exists (permission_profile_id was previously only ever set once, at
 * creation, inside createUserWithGeneratedUsername -- there was no way to
 * move an existing Employee onto a different profile without deleting and
 * recreating their login, losing their username/history).
 */
export function updateUserPermissionProfile(
  userId: number,
  permissionProfileId: number
): void {

  const db = getDatabase();

  const target = getUserById(userId);

  if (!target) {
    throw new Error("User not found.");
  }

  if (target.user_type !== "employee") {
    throw new Error("Only Employee accounts can be assigned a permission profile.");
  }

  db.prepare(`
    UPDATE users
    SET permission_profile_id = @permissionProfileId,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: userId, permissionProfileId });

}

export function updatePasswordHash(
  userId: number,
  passwordHash: string,
  mustChangePassword: boolean
): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET password_hash = @password_hash,
        must_change_password = @must_change_password,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: userId,
    password_hash: passwordHash,
    must_change_password: mustChangePassword ? 1 : 0
  });

}

/**
 * Owner Recovery Key (Task 2). Stored the same way password_hash is --
 * only a hash, never the plaintext key -- and only ever set on the
 * single 'owner' row. Used by setupOwnerAccount (initial generation)
 * and resetOwnerPasswordWithRecoveryKey (rotation after a successful
 * recovery, so a used/exposed key can never be reused).
 */
export function setRecoveryKeyHash(userId: number, recoveryKeyHash: string): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET recovery_key_hash = @recovery_key_hash,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: userId, recovery_key_hash: recoveryKeyHash });

}

/**
 * Forgot Username. Looks up exactly one active account by full name +
 * a matching email or phone (both already stored on the users row --
 * see the full_name/email/phone columns added for the Edit Profile
 * form). This is the same "something only the account owner would
 * know" identity check used elsewhere in an offline, single-machine
 * app with no email/SMS service to verify through -- no new service,
 * no new dependency, no admin workflow. Only ever returns a username
 * on an exact, unique match; every other case (no match, ambiguous
 * partial match, wrong field) returns the same generic "not found"
 * so the response never confirms which detail was wrong.
 */
export function findUsernameByIdentity(fullName: string, contact: string): string | null {

  const db = getDatabase();

  const normalizedName = fullName.trim().toLowerCase();
  const normalizedContact = contact.trim().toLowerCase();

  if (!normalizedName || !normalizedContact) {
    return null;
  }

  const rows = db
    .prepare(`
      SELECT username
      FROM users
      WHERE status = 'active'
        AND LOWER(TRIM(full_name)) = @name
        AND (
          LOWER(TRIM(email)) = @contact
          OR LOWER(TRIM(phone)) = @contact
        )
    `)
    .all({ name: normalizedName, contact: normalizedContact }) as { username: string }[];

  return rows.length === 1 ? rows[0].username : null;

}

/**
 * Renames a user's own login username (Edit Profile). Uniqueness is
 * the caller's responsibility (see auth-manager.ts's updateProfile,
 * which checks isUsernameTaken first) -- same division of
 * responsibility as password changes, where hashing/validation happens
 * one layer up and this function only ever performs the write.
 */
export function updateUsername(userId: number, username: string): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET username = @username,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: userId, username });

}

/**
 * Edit Profile (expanded form). username is always required/handled
 * by updateUsername above -- this covers the rest of the editable
 * fields. designation is included here too (it's just a column write)
 * but whether the caller is ALLOWED to change it is decided one layer
 * up, in auth-manager.ts's updateProfile / main.ts's IPC handler
 * (employees.edit permission check) -- this function trusts its
 * caller, same division of responsibility as updateUsername.
 */
export function updateUserProfileFields(
  userId: number,
  fields: { full_name?: string; email?: string; phone?: string; designation?: string }
): void {

  const db = getDatabase();

  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return;
  }

  const setClause = columns.map(col => `${col} = @${col}`).join(", ");

  db.prepare(`
    UPDATE users
    SET ${setClause},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: userId, ...fields });

}

/**
 * Profile Picture (own account). Mirrors saveEmployeePhoto /
 * removeEmployeePhoto / getEmployeePhotoDataUrl in
 * employee-repository.ts exactly -- same resize/compress path
 * (employee-photo-service.ts), same BLOB-on-the-owning-row storage.
 * photo_blob/photo_mime are deliberately left out of UserRecord/
 * SafeUser above so a photo (large binary) is never fetched as part of
 * every getCurrentUser()/session-restore call -- these three functions
 * are the only place they're read or written.
 */
export function saveUserPhoto(userId: number, buffer: Buffer, mime: string): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET photo_blob = ?, photo_mime = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(buffer, mime, userId);

}

export function removeUserPhoto(userId: number): void {

  const db = getDatabase();

  db.prepare(`
    UPDATE users
    SET photo_blob = NULL, photo_mime = '', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(userId);

}

export function getUserPhotoDataUrl(userId: number): string | null {

  const db = getDatabase();

  const row = db
    .prepare("SELECT photo_blob, photo_mime FROM users WHERE id = ?")
    .get(userId) as { photo_blob: Buffer | null; photo_mime: string | null } | undefined;

  if (row?.photo_blob) {
    return `data:${row.photo_mime || "image/png"};base64,${row.photo_blob.toString("base64")}`;
  }

  return null;

}

/**
 * Offline Username/Password Recovery -- local identity verification.
 * Matches Employee Number + Citizen ID/Residence ID number + Date of
 * Birth against the SAME employees row (employee_number is the same
 * user-facing identifier issued at employee creation -- see
 * employee-repository.ts's generateEmployeeNumber), then resolves
 * that employee back to their users row via employee_id. All three
 * fields must belong to the same employee -- this is not three
 * independent lookups. No SMS/email/online service involved --
 * everything already lives in the local database.
 *
 * The Owner is never a valid match: Owner recovery is the separate
 * Recovery Key flow (see recovery_key_hash above), and typically has
 * no linked employee row at all.
 */
export function findUserByOfflineIdentity(
  identityNumber: string,
  dateOfBirth: string,
  employeeId: string
): UserRecord | undefined {

  const db = getDatabase();

  const normalizedNumber = identityNumber.trim().toLowerCase();
  const normalizedDob = dateOfBirth.trim();
  const normalizedEmployeeId = employeeId.trim().toLowerCase();

  if (!normalizedNumber || !normalizedDob || !normalizedEmployeeId) {
    return undefined;
  }

  return db
    .prepare(`
      SELECT u.*
      FROM users u
      JOIN employees e ON e.id = u.employee_id
      WHERE u.status = 'active'
        AND u.user_type != 'owner'
        AND LOWER(TRIM(e.identity_number)) = @number
        AND e.identity_type IN ('Citizen ID', 'Residence ID')
        AND e.date_of_birth IS NOT NULL
        AND date(e.date_of_birth) = date(@dob)
        AND LOWER(TRIM(e.employee_number)) = @employeeId
    `)
    .get({
      number: normalizedNumber,
      dob: normalizedDob,
      employeeId: normalizedEmployeeId
    }) as UserRecord | undefined;

}

/**
 * All active user ids of a given type -- used to fan a single event
 * (e.g. a new Account Recovery request) out to every eligible
 * reviewer's inbox (every Administrator, or the Owner) without the
 * caller needing to know how many of them there are.
 */
export function listUserIdsByType(userType: UserType): number[] {

  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT id
      FROM users
      WHERE user_type = ?
        AND status = 'active'
    `)
    .all(userType) as { id: number }[];

  return rows.map(row => row.id);

}
