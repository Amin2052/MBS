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
  /** Legacy compatibility only. New licenses use businessMode as the sole
   * entitlement selector; MBS never uses this field for access control. */
  features?: string[];
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
   * Cloud/API/integration entitlement, set only in the Activation Generator
   * and covered by the license signature like every other field.
   *
   * `mode` decides how MBS must treat apiUrl/workspaceId/apiKey below:
   *  - "developer_managed" (default when `mode` is absent, for backward
   *    compatibility with licenses issued before `mode` existed): these are
   *    the real, developer-supplied values. MBS must treat them as
   *    read-only, authoritative configuration to apply internally -- never
   *    render the raw apiKey to the renderer, never accept a
   *    renderer-supplied replacement for it.
   *  - "customer_managed": the license only grants the *entitlement* to
   *    connect a cloud/server; apiUrl/workspaceId/apiKey here are always
   *    empty by design. MBS must instead source the actual connection
   *    details from a customer-entered, locally-stored value (see
   *    cloud-config-service.ts) -- never from this license field.
   *
   * Optional for backward compatibility with licenses issued before this
   * field existed; absent means "no licensed cloud configuration", never a
   * reason to fall back to customer input.
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

  // licensedCloudConfig is optional (legacy licenses, or licenses issued
  // without cloud entitlement, omit it), but if present every field must be
  // the correct type -- a malformed shape here must fail closed rather than
  // be partially trusted.
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

  if (v.features !== undefined) {
    if (!Array.isArray(v.features)) return false;
    if (!v.features.every((f) => typeof f === "string")) return false;
  }

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
