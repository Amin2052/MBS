import type { PropsWithChildren } from "react";
import { Lock } from "lucide-react";

import { useBusinessMode, type BusinessMode } from "@/hooks/use-business-mode";

import "./auth-shared.css";

// ===================================================================
// Require Business Mode
//
// Route-level Enterprise gate, parallel in shape to
// require-module-access.tsx. Wraps a page's route element; if the
// active (validated) Business Mode entitlement doesn't include the
// required mode, an upgrade message is shown instead of the page.
// This never reads client-side/customer-facing state — it goes
// through useBusinessMode(), which is sourced from the verified
// license status only (see use-business-mode.ts).
// ===================================================================

export default function RequireBusinessMode({
  requires,
  children
}: PropsWithChildren<{ requires: BusinessMode }>): JSX.Element {

  const { mode, loading } = useBusinessMode();

  if (loading) return <></>;

  if (requires === "enterprise" && mode !== "enterprise") {

    return (
      <div className="auth-screen" style={{ height: "auto", padding: "64px 32px" }}>
        <div className="auth-card" style={{ textAlign: "center" }}>
          <Lock size={28} className="auth-icon" style={{ margin: "0 auto 12px" }} />
          <h1 className="auth-title">Enterprise Feature</h1>
          <p className="auth-subtitle">This section is available on the Enterprise plan. Upgrade your license to unlock it.</p>
        </div>
      </div>
    );

  }

  return <>{children}</>;

}
