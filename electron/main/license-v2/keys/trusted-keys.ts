// ===================================================================
// Trusted Verification Keys
//
// MBS trusts a small, explicit set of public keys. Every license
// names the keyId it was signed with, so a future key rotation just
// means: generate a new keypair in the Generator, add the new public
// key here with a new keyId, and keep the old public key in this
// list (marked retired) so previously-issued licenses signed with it
// still verify. Never remove a retired key unless you are
// deliberately invalidating every license it ever signed.
//
// IMPORTANT: This file contains PUBLIC keys only. There is no private
// key material anywhere in the MBS codebase.
// ===================================================================

export interface TrustedKey {
  keyId: string;
  algorithm: "ed25519";
  publicKeyBase64: string;
  status: "active" | "retired";
  /**
   * "development" keys must NEVER be trusted by a packaged/production
   * build -- only by `npm run dev` / unpackaged runs. findTrustedKey()
   * below is the single place this is enforced; every caller must pass
   * through the real `app.isPackaged` state rather than hard-coding
   * `allowDevelopmentKeys: true`.
   */
  environment: "development" | "production";
  /** Human note for whoever edits this file during a rotation. */
  note: string;
}

// -------------------------------------------------------------------
// DEVELOPMENT KEY — for local development/testing ONLY.
//
// This keypair was generated purely for this repository's dev/test
// flow. Its private half lives only in the developer instance of the
// MBS License Generator's dev vault (never committed) and must NEVER
// be used to sign a license shipped to a real customer.
//
// PRODUCTION KEY — provisioned 2026-09 via the Generator's dedicated
// production profile (`npm run dev:prod` / `npm run dist:win`, both
// of which set MBS_GENERATOR_ENV=production -- see the Generator's
// electron/main/main.ts). Its private half lives only in that
// profile's encrypted vault, never in this repository.
//
// A future key rotation: generate a new keypair in a fresh Generator
// production profile, add its public key here under a new keyId, and
// keep this one (marked retired) so licenses already issued with it
// keep verifying.
// -------------------------------------------------------------------
export const TRUSTED_KEYS: TrustedKey[] = [
  {
    keyId: "dev-2026-08",
    algorithm: "ed25519",
    publicKeyBase64: "/193GnLvxBalIMMWm9C3C0yjQwmX1CulyBe3VOZzTEY=",
    status: "active",
    environment: "development",
    note: "Development/testing key only. Not for production licenses."
  },

  {
    keyId: "prod-2026-09",
    algorithm: "ed25519",
    publicKeyBase64: "3+qSHlpyvbLLn6llTyffnyY6Dg+qDN1/KEqeM6BHYs4=",
    status: "active",
    environment: "production",
    note: "Production signing key, provisioned 2026-09. Generated via `npm run dev:prod` " +
      "in the Generator's dedicated production userData profile (see electron/main/main.ts " +
      "in the Generator app). This replaces the earlier prod-2026-08 placeholder entry, " +
      "which was scaffolding with no corresponding private key ever held by this " +
      "installation -- no license could have been validly signed with it, so it was safe " +
      "to remove outright rather than mark retired."
  }
,

  {
    keyId: "prod-2026-11",
    algorithm: "ed25519",
    publicKeyBase64: "oJoo9TjC6RekTVR7/qHfgTL+dtHgnxahkkRMsl0CSWI=",
    status: "active",
    environment: "production",
    note: "Production signing key provisioned 2026-11 by the Generator's production " +
      "profile (MBS_GENERATOR_ENV=production). Its private half lives only in that " +
      "profile's encrypted vault, never in this repository. This is the key the currently " +
      "issued Enterprise licences are signed with; a rotation must add the new public key " +
      "here and mark this one retired, not delete it."
  }
];

/**
 * Looks up a trusted key by id, gated by environment.
 *
 * `allowDevelopmentKeys` must be derived from `!app.isPackaged` (see
 * every call site in license-manager.ts / revocation.ts) -- it must
 * never be hard-coded `true`. A packaged/production build passing
 * `allowDevelopmentKeys: false` (the default) will silently reject any
 * license or revocation bundle signed with a `development` key, even
 * if one is present in TRUSTED_KEYS above.
 */
export function findTrustedKey(
  keyId: string,
  options: { allowDevelopmentKeys: boolean } = { allowDevelopmentKeys: false }
): TrustedKey | undefined {
  const key = TRUSTED_KEYS.find((k) => k.keyId === keyId);
  if (!key) return undefined;
  if (key.environment === "development" && !options.allowDevelopmentKeys) {
    return undefined;
  }
  return key;
}
