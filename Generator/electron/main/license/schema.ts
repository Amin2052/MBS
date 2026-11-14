// ===================================================================
// License Schema (v1)
//
// The signed payload format. Both the Generator and MBS must agree on
// this shape; MBS's copy here is read/validate-only.
// ===================================================================

export type LicenseType = "trial" | "standard" | "professional" | "enterprise";

export type ActivationStatus = "issued" | "activated" | "revoked" | "expired";

/** Business Mode entitlement (Phase 2). Optional for backward compatibility
 * with licenses issued before this field existed — see isValidBusinessMode
 * below for how an absent/invalid value must be treated by callers. */
export type BusinessMode = "starter" | "enterprise";

export interface LicensePayloadV1 {
  schemaVersion: 1;
  licenseId: string;
  productId: "mooral-business-suite";
  productSchema: string;
  customerName: string;
  companyName: string;
  licenseType: LicenseType;
  issueDate: string;
  expirationDate: string | null;
  machineFingerprint: string;
  features: string[];
  activationStatus: ActivationStatus;
  keyId: string;
  algorithm: "ed25519";
  createdAt: string;
  /** Links a replacement/renewal license back to its predecessor. */
  supersedesLicenseId?: string;
  relationship?: "original" | "reexport" | "replacement" | "renewal";
  /** Customer-facing reference; the complete signed license remains authoritative. */
  activationCode?: string;
  /** Business Mode entitlement (Starter/Enterprise). Optional so legacy
   * licenses without it remain structurally valid; absent/invalid values
   * MUST be treated as "no Enterprise entitlement" by every consumer,
   * never defaulted to "enterprise". Covered by the signature like every
   * other field, since canonicalize() serializes the whole payload. */
  businessMode?: BusinessMode;
  /**
   * Cloud/API/integration entitlement. Mirrors MBS's
   * electron/main/license-v2/license/schema.ts exactly -- MBS is the
   * authoritative consumer-side contract for this field; do not diverge.
   *
   * `mode` decides how MBS treats apiUrl/workspaceId/apiKey:
   *  - "developer_managed" (default when absent): these must be the real,
   *    developer-supplied connection values -- MBS applies them internally
   *    and never renders apiKey to its renderer.
   *  - "customer_managed": the license only grants the *entitlement*;
   *    apiUrl/workspaceId/apiKey here must be left empty by design, since
   *    MBS instead sources them from the customer's own locally-entered
   *    configuration.
   *
   * Optional for backward compatibility with licenses issued before this
   * field existed.
   */
  licensedCloudConfig?: {
    enabled: boolean;
    mode?: "developer_managed" | "customer_managed";
    apiUrl: string;
    workspaceId: string;
    apiKey: string;
  };
}

export interface ActivationPackageV1 {
  schemaVersion: 1;
  productId: "mooral-business-suite";
  activationCode: string;
  signedLicense: SignedLicense;
}

export interface SignedLicense {
  payload: LicensePayloadV1;
  signature: string;
  encoding: "base64url-ed25519";
}

export interface LicenseValidationResult {
  valid: boolean;
  status:
    | "valid"
    | "invalid_format"
    | "invalid_signature"
    | "unknown_key"
    | "wrong_product"
    | "wrong_machine"
    | "expired"
    | "revoked";
  payload?: LicensePayloadV1;
  reason?: string;
}

const REQUIRED_STRING_FIELDS: (keyof LicensePayloadV1)[] = [
  "licenseId",
  "productId",
  "productSchema",
  "customerName",
  "companyName",
  "licenseType",
  "issueDate",
  "machineFingerprint",
  "keyId",
  "algorithm",
  "createdAt"
];

const VALID_LICENSE_TYPES: LicenseType[] = [
  "trial",
  "standard",
  "professional",
  "enterprise"
];

/**
 * Structural validation only — does NOT check the signature. Callers
 * must run this before/alongside signature verification, since a
 * well-formed-but-unsigned object should never be trusted on its own.
 */
export function isStructurallyValidPayload(
  value: unknown
): value is LicensePayloadV1 {

  if (!value || typeof value !== "object") return false;

  const v = value as Record<string, unknown>;

  if (v.schemaVersion !== 1) return false;
  if (v.productId !== "mooral-business-suite") return false;
  if (v.algorithm !== "ed25519") return false;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof v[field] !== "string" || (v[field] as string).length === 0) {
      return false;
    }
  }

  if (!VALID_LICENSE_TYPES.includes(v.licenseType as LicenseType)) {
    return false;
  }

  // businessMode is optional (legacy licenses may omit it), but if present
  // it must be one of the two approved values — never trust anything else.
  if (v.businessMode !== undefined && v.businessMode !== "starter" && v.businessMode !== "enterprise") {
    return false;
  }

  // licensedCloudConfig is optional, but if present every field must be the
  // correct type -- a malformed shape must fail closed, mirroring MBS's own
  // isStructurallyValidPayload() exactly.
  if (v.licensedCloudConfig !== undefined) {
    const cc = v.licensedCloudConfig as Record<string, unknown>;
    if (!cc || typeof cc !== "object") return false;
    if (typeof cc.enabled !== "boolean") return false;
    if (cc.mode !== undefined && cc.mode !== "developer_managed" && cc.mode !== "customer_managed") return false;
    if (typeof cc.apiUrl !== "string") return false;
    if (typeof cc.workspaceId !== "string") return false;
    if (typeof cc.apiKey !== "string") return false;
  }

  if (v.expirationDate !== null && typeof v.expirationDate !== "string") {
    return false;
  }

  if (!Array.isArray(v.features)) return false;
  if (!v.features.every((f) => typeof f === "string")) return false;

  if (
    v.activationStatus !== "issued" &&
    v.activationStatus !== "activated" &&
    v.activationStatus !== "revoked" &&
    v.activationStatus !== "expired"
  ) {
    return false;
  }

  if (isNaN(Date.parse(v.issueDate as string))) return false;
  if (v.expirationDate !== null && isNaN(Date.parse(v.expirationDate as string))) {
    return false;
  }
  if (isNaN(Date.parse(v.createdAt as string))) return false;

  return true;

}

export function isStructurallyValidSignedLicense(
  value: unknown
): value is SignedLicense {

  if (!value || typeof value !== "object") return false;

  const v = value as Record<string, unknown>;

  if (v.encoding !== "base64url-ed25519") return false;
  if (typeof v.signature !== "string" || v.signature.length === 0) return false;

  return isStructurallyValidPayload(v.payload);

}

/** Safe accessor for the Business Mode entitlement. Missing or malformed
 * values MUST resolve to "starter" (never "enterprise") — this is the
 * single place that decision is made so every caller (Generator UI,
 * MBS activation flow) stays consistent with Phase 3 rule #20 (invalid/
 * missing mode must never be treated as Enterprise). */
export function resolveBusinessMode(payload: Pick<LicensePayloadV1, "businessMode">): BusinessMode {
  return payload.businessMode === "enterprise" ? "enterprise" : "starter";
}
