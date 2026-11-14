import { licenseManagerV2 } from "../license-v2/license-manager";

// ===================================================================
// Business Mode (Phase 5 Security fix)
//
// SECURITY: this module previously stored Business Mode as a freely
// editable column (company_settings.business_mode) that any Owner
// could flip via a button in Security Settings -- a second, insecure
// entitlement system that bypassed the signed license entirely
// (exactly the "customer-facing dropdown" / "manually editable
// configuration" the licensing spec forbids). That has been removed.
//
// getBusinessMode() now does nothing but re-export the same
// license-derived value every other Business Mode check in the app
// uses (licenseManagerV2.getStatus().businessMode, safely defaulted to
// "starter"). There is no setBusinessMode() anymore -- Business Mode
// can only change by activating a different signed license.
// ===================================================================

export type BusinessMode = "starter" | "enterprise";

export function getBusinessMode(): BusinessMode {

  const status = licenseManagerV2.getStatus();

  return status.businessMode === "enterprise" ? "enterprise" : "starter";

}
