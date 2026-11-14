import { licenseManagerV2 } from "./license-manager";

// ===================================================================
// Business Mode Data Quotas (Phase 4)
//
// Single source of truth for the approved Starter/Enterprise data
// limits (requirement 12/13) and the entity-specific enforcement rule
// (requirement 15: one exhausted quota never blocks unrelated
// entities). Repositories call assertWithinQuota() immediately before
// their INSERT, passing a fresh COUNT(*) they already have to run
// anyway. Enterprise is always unlimited; the Business Mode itself is
// read once per call from licenseManagerV2.getStatus(), which is the
// same validated-entitlement path everything else in the app uses —
// this file never trusts client/renderer input.
// ===================================================================

export type QuotaEntity =
  | "customers"
  | "products"
  | "orders"
  | "invoices"
  | "certificates"
  | "employees"
  | "accountingRecords"
  | "inventoryTransactions";

/** Final approved Starter limits (requirement 12). Users/login accounts
 * are handled separately in auth code — they're explicitly NOT part of
 * the 20% formula (requirement 13) and aren't a repository-layer quota. */
export const STARTER_LIMITS: Record<QuotaEntity, number> = {
  customers: 1000,
  products: 1000,
  orders: 2000,
  invoices: 2000,
  certificates: 1000,
  employees: 20,
  accountingRecords: 10000,
  inventoryTransactions: 10000
};

const ENTITY_LABELS: Record<QuotaEntity, string> = {
  customers: "customer",
  products: "product",
  orders: "order",
  invoices: "invoice",
  certificates: "certificate",
  employees: "employee",
  accountingRecords: "accounting record",
  inventoryTransactions: "inventory transaction"
};

export class QuotaExceededError extends Error {
  constructor(public entity: QuotaEntity, public limit: number) {
    super(
      `Starter ${ENTITY_LABELS[entity]} limit reached (${limit}). Upgrade to Enterprise for unlimited ${ENTITY_LABELS[entity]}s.`
    );
    this.name = "QuotaExceededError";
  }
}

/**
 * Throws QuotaExceededError if the Business Mode is Starter and
 * currentCount is already at/over that entity's limit. No-op for
 * Enterprise and for the (safe-default) Starter mode when there is no
 * active/valid license status at all — trial/unlicensed installs still
 * get the Starter caps, never an unlimited bypass.
 */
export function assertWithinQuota(entity: QuotaEntity, currentCount: number): void {

  const status = licenseManagerV2.getStatus();
  const mode = status.businessMode === "enterprise" ? "enterprise" : "starter";

  if (mode === "enterprise") return;

  const limit = STARTER_LIMITS[entity];

  if (currentCount >= limit) {
    throw new QuotaExceededError(entity, limit);
  }

}
