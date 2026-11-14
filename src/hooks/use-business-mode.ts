import { useLicense } from "@/hooks/use-license";

export type BusinessMode = "starter" | "enterprise";

// ===================================================================
// Business Mode (Phase 3/4)
//
// Thin derived accessor over the existing license status — NOT a new
// state store. The authoritative value already lives in
// LicenseProvider's `status`, which license-manager.ts (main process)
// populates only from a freshly re-verified signed license payload via
// resolveBusinessMode(). This hook never reads localStorage, URL
// params, or any client-only state; it exists purely so components
// don't have to repeat the "default to starter until proven
// enterprise" fallback everywhere.
// ===================================================================

export function useBusinessMode(): { mode: BusinessMode; isEnterprise: boolean; loading: boolean } {
  const { status, loading } = useLicense();
  const mode: BusinessMode = status?.businessMode === "enterprise" ? "enterprise" : "starter";
  return { mode, isEnterprise: mode === "enterprise", loading };
}
