import { useNavigate } from "react-router-dom";

import {
  Building2,
  Receipt,
  Globe,
  Users,
  Calculator,
  Warehouse,
  ShoppingCart,
  UserCog,
  ShieldCheck,
  Bell,
  Plug,
  FileText,
  Database,
  KeyRound,
  Info,
  Award,
  Lock
} from "lucide-react";

import { useBusinessMode } from "@/hooks/use-business-mode";
import { useLanguage } from "@/hooks/use-language";

import "./settings.css";

interface SettingsCategory {
  id: string;
  titleKey: string;
  path: string;
  icon: typeof Building2;
  /** Requirement 10/11: some settings categories (currently only
   * multi-user administration) are Enterprise-only. Starter still sees
   * the tile — navigation isn't removed — but it's marked and the
   * route itself is gated by RequireBusinessMode in routes.tsx, which
   * is the actual enforcement point. */
  enterpriseOnly?: boolean;
}

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "company-profile", titleKey: "settingsHub.companyProfile", path: "/settings/company-profile", icon: Building2 },
  { id: "financial-invoice", titleKey: "settingsHub.financialInvoice", path: "/settings/financial-invoice", icon: Receipt },
  { id: "certificate", titleKey: "settingsHub.certificate", path: "/settings/certificate-settings", icon: Award },
  { id: "localization", titleKey: "settingsHub.localization", path: "/settings/localization", icon: Globe },
  { id: "user-management", titleKey: "settingsHub.userManagement", path: "/settings/user-management", icon: Users, enterpriseOnly: true },
  { id: "finance-accounting", titleKey: "settingsHub.financeAccounting", path: "/settings/finance-accounting", icon: Calculator },
  { id: "inventory-warehouse", titleKey: "settingsHub.inventoryWarehouse", path: "/settings/inventory-settings", icon: Warehouse },
  { id: "sales-purchase", titleKey: "settingsHub.salesPurchase", path: "/settings/sales-purchase", icon: ShoppingCart },
  { id: "hr-payroll", titleKey: "settingsHub.hrPayroll", path: "/settings/hr-payroll", icon: UserCog },
  { id: "security-privacy", titleKey: "settingsHub.securityPrivacy", path: "/settings/security-settings", icon: ShieldCheck },
  { id: "notifications", titleKey: "settingsHub.notifications", path: "/settings/notifications", icon: Bell },
  { id: "integrations-apis", titleKey: "settingsHub.integrationsApis", path: "/settings/integrations", icon: Plug },
  { id: "document-templates", titleKey: "settingsHub.documentTemplates", path: "/settings/document-templates", icon: FileText },
  { id: "database", titleKey: "settingsHub.database", path: "/settings/database-settings", icon: Database },
  { id: "license-activation", titleKey: "settingsHub.licenseActivation", path: "/settings/license-settings", icon: KeyRound },
  { id: "about", titleKey: "settingsHub.about", path: "/settings/about", icon: Info }
];

export default function SettingsPage(): JSX.Element {

  const navigate = useNavigate();
  const { isEnterprise } = useBusinessMode();
  const { t } = useLanguage();

  return (
    <div className="settings-page">

      <div className="settings-header">
        <h1>{t("settingsHub.title")}</h1>
        <p>{t("settingsHub.subtitle")}</p>
      </div>

      <div className="settings-grid">

        {SETTINGS_CATEGORIES.map(category => {

          const Icon = category.icon;

          return (
            <button
              key={category.id}
              type="button"
              className="settings-card"
              onClick={() => navigate(category.path)}
            >
              <Icon size={20} className="settings-card-icon" />
              <span>{t(category.titleKey)}</span>
              {category.enterpriseOnly && !isEnterprise && (
                <Lock size={13} className="settings-card-lock" aria-label={t("settingsHub.enterpriseOnly")} />
              )}
            </button>
          );

        })}

        <div className="settings-about-card" aria-label={t("settingsHub.aboutInfo")}>
          <div className="settings-about-title">
            <strong>Mooral Business Suite</strong>
          </div>
          <div className="settings-about-developer">{t("settingsHub.developedBy")}</div>
          <div className="settings-about-contact">
            <span>📱 +8801863036547</span>
            <span>✉ alamin2052@gmail.com</span>
          </div>
          <div className="settings-about-footer">{t("settingsHub.releaseFooter")}</div>
        </div>

      </div>

    </div>
  );

}
