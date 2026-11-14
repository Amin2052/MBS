import type { PropsWithChildren } from "react";
import { ShieldOff } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import type { PermissionModule } from "@/auth/permission-catalog";

import "./auth-shared.css";

// ===================================================================
// Require Module Access
//
// Route-level "module filtering" from the spec's Permission Engine
// phase. Wraps a page's route element; if the current user lacks
// `${module}.view`, an Access Denied message is shown instead of the
// page. This is a thin, reusable wrapper -- routes.tsx applies it
// per-route rather than each page checking permissions itself, so
// there's exactly one place this rule lives.
// ===================================================================

export default function RequireModuleAccess({
  module,
  children
}: PropsWithChildren<{ module: PermissionModule }>): JSX.Element {

  const { hasPermission } = useAuth();

  if (!hasPermission(`${module}.view`)) {

    return (
      <div className="auth-screen" style={{ height: "auto", padding: "64px 32px" }}>
        <div className="auth-card" style={{ textAlign: "center" }}>
          <ShieldOff size={28} className="auth-icon" style={{ margin: "0 auto 12px" }} />
          <h1 className="auth-title">Access Denied</h1>
          <p className="auth-subtitle">You don't have permission to view this section.</p>
        </div>
      </div>
    );

  }

  return <>{children}</>;

}
