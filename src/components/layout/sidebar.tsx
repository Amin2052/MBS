import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Award,
  BookOpen,
  Boxes,
  ChartColumn,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  UserCog,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { NAVIGATION_ITEMS } from "@/constants/navigation";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import type { PermissionKey } from "@/auth/permission-catalog";

/**
 * Graphite Atelier sidebar.
 *
 * Presentation only: the permission filter, the NAVIGATION_ITEMS source of
 * truth, the NavLink targets and the version lookup are all unchanged from
 * the previous implementation. What changed is the visual language — a real
 * logo mark, one refined line icon per destination, a workspace section
 * label, and a footer that carries the database/version indicator.
 *
 * Icons are looked up by nav id so `constants/navigation.ts` stays a plain
 * data file with no React/icon dependency.
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  customers: Users,
  products: Package,
  inventory: Boxes,
  orders: ShoppingCart,
  invoices: FileText,
  accounting: BookOpen,
  reports: ChartColumn,
  employees: UserCog,
  certificates: Award,
  settings: Settings
};

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
      <div className="sidebar-brand">
        <span className="sidebar-brand-text">
          <strong>Mooral</strong>
          <span>Business Suite</span>
        </span>
      </div>

      <p className="sidebar-section-label">{t("shell.workspace")}</p>

      <nav className="sidebar-nav" aria-label={t("shell.workspace")}>
        <ul>
          {visibleItems.map((item) => {
            const Icon = NAV_ICONS[item.id] ?? Package;

            return (
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
                  <Icon className="sidebar-link-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="sidebar-link-label">{t(`nav.${item.id}`)}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <span className="ga-dot ga-dot--online" aria-hidden="true" />
        <span className="sidebar-footer-text">MBS</span>
        {appVersion && <span className="sidebar-footer-version">v{appVersion}</span>}
      </div>
    </aside>
  );
}
