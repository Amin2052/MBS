import crypto from "node:crypto";

// ===================================================================
// Password Hashing
//
// Uses Node's built-in `crypto.scrypt` rather than a bcrypt/argon2
// dependency. Two reasons: (1) it needs zero additional native
// modules -- the project already depends on electron-rebuild solely
// for better-sqlite3, and every extra native dependency is another
// thing that can go out of ABI sync with Electron's bundled Node; (2)
// scrypt is a memory-hard KDF (real resistance to GPU/ASIC brute
// force), which is what actually matters for "must be secure" -- it
// is not a weaker choice than bcrypt, just a dependency-free one.
//
// Stored format is self-describing, so parameters can be strengthened
// later without invalidating existing hashes:
//
//   scrypt$N$r$p$<saltHex>$<hashHex>
//
// verifyPassword() reads N/r/p from the stored string itself rather
// than assuming today's constants, so raising CURRENT_PARAMS in the
// future re-hashes nothing by itself but still correctly verifies
// every old hash forever (backward compatible, per the spec's
// decision rules).
// ===================================================================

const CURRENT_PARAMS = {
  N: 16384, // CPU/memory cost factor
  r: 8,     // block size
  p: 1,     // parallelization
  keyLength: 64
};

function scryptDerive(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  keyLength: number
): Promise<Buffer> {

  return new Promise((resolve, reject) => {

    crypto.scrypt(
      password,
      salt,
      keyLength,
      { N, r, p, maxmem: 256 * 1024 * 1024 },
      (error, derivedKey) => {

        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);

      }
    );

  });

}

export async function hashPassword(password: string): Promise<string> {

  const salt = crypto.randomBytes(16);

  const derivedKey = await scryptDerive(
    password,
    salt,
    CURRENT_PARAMS.N,
    CURRENT_PARAMS.r,
    CURRENT_PARAMS.p,
    CURRENT_PARAMS.keyLength
  );

  return [
    "scrypt",
    CURRENT_PARAMS.N,
    CURRENT_PARAMS.r,
    CURRENT_PARAMS.p,
    salt.toString("hex"),
    derivedKey.toString("hex")
  ].join("$");

}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {

  const parts = storedHash.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;

  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  const actual = await scryptDerive(password, salt, N, r, p, expected.length);

  // Constant-time comparison -- same rationale as the license module's
  // HMAC verification (electron/main/license/security/crypto.ts).
  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);

}

/**
 * Minimum password strength gate used by both the First-Time Setup
 * Wizard (Owner creation) and any future Change Password / Create
 * Employee flows. Kept intentionally simple in Phase 1 (length only)
 * -- Phase 5's Security Policies is the designated place for
 * configurable complexity rules, so this function is the one spot
 * those rules will plug into later without touching callers.
 */
export function isPasswordStrongEnough(password: string): boolean {

  return typeof password === "string" && password.length >= 8;

}

/**
 * Generates a secure, random temporary password for a newly created
 * Administrator or Employee account (spec: "Administrator never
 * creates passwords manually"). Mixes character classes and uses
 * crypto.randomInt for uniform, non-biased selection -- not
 * Math.random(). Always paired with must_change_password = true.
 */
export function generateTemporaryPassword(): string {

  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const LOWER = "abcdefghijkmnopqrstuvwxyz";
  const DIGITS = "23456789";
  const SYMBOLS = "!@#$%&*";

  const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

  function pick(chars: string): string {
    return chars[crypto.randomInt(0, chars.length)];
  }

  const required = [
    pick(UPPER),
    pick(LOWER),
    pick(DIGITS),
    pick(SYMBOLS)
  ];

  const remainingLength = 10 - required.length;

  const rest = Array.from(
    { length: remainingLength },
    () => pick(ALL)
  );

  const combined = [...required, ...rest];

  // Fisher-Yates shuffle so the required characters aren't always in
  // the first four positions.
  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");

}

/**
 * Generates the human-relayed Reset Code used by the Forgot Password
 * Workflow (Task 2): an Administrator/Owner reads this code out to the
 * requesting Employee/Administrator (in person, by phone, etc.) after
 * approving their request. Short and free of visually-ambiguous
 * characters (0/O, 1/I) since it is meant to be read aloud and typed
 * back in, unlike generateTemporaryPassword()'s longer login password.
 * Only its hash (via hashPassword) is ever stored.
 */
export function generateResetCode(): string {

  const CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

  return Array.from(
    { length: 8 },
    () => CHARS[crypto.randomInt(0, CHARS.length)]
  ).join("");

}

/**
 * Generates the Owner's Recovery Key (Task 2): shown exactly once,
 * during First-Time Setup (and again if the Owner ever completes a
 * recovery, since the key is rotated afterward -- see
 * resetOwnerPasswordWithRecoveryKey). Only its hash is ever stored, the
 * same principle as password_hash. Grouped into dashes purely for
 * readability; nothing about the grouping is meaningful.
 */
export function generateRecoveryKey(): string {

  const CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

  function group(): string {
    return Array.from(
      { length: 4 },
      () => CHARS[crypto.randomInt(0, CHARS.length)]
    ).join("");
  }

  return [group(), group(), group(), group()].join("-");

}
