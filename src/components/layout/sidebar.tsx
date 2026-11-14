import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { NAVIGATION_ITEMS } from "@/constants/navigation";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import type { PermissionKey } from "@/auth/permission-catalog";

export default function Sidebar(): JSX.Element {

  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  // PHASE 10 UI AUDIT FIX: this used to be a hardcoded "v0.1.0" string that
  // had drifted from package.json's real version (0.1.11 at time of fix).
  // window.mooral.app.getInfo().appVersion (Electron's own app.getVersion(),
  // already used correctly by the About settings page) is the actual
  // single source of truth, so read it the same way here instead of
  // maintaining a second, easily-stale copy of the version number.
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    window.mooral.app.getInfo()
      .then((info) => {
        if (isMounted) setAppVersion(info.appVersion);
      })
      .catch(() => {
        // Non-critical display value; silently leave blank rather than
        // showing a stale/incorrect fallback string.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const visibleItems = NAVIGATION_ITEMS.filter(item =>
    hasPermission(`${item.permissionModule ?? item.id}.view` as PermissionKey)
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Mooral Business Suite</h1>
        {appVersion && <span>v{appVersion}</span>}
      </div>

      <nav className="sidebar-nav">
        <ul>
          {visibleItems.map((item) => (
            <li key={item.id}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  isActive
                    ? "sidebar-link sidebar-link-active"
                    : "sidebar-link"
                }
              >
                {t(`nav.${item.id}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
