import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import ProfilePage from "@/pages/profile-page";
import ChangePasswordPage from "@/pages/change-password-page";
import AppLayout from "@/layouts/app-layout";
import RequireModuleAccess from "@/components/auth/require-module-access";
import RequireBusinessMode from "@/components/auth/require-business-mode";

// PERFORMANCE (Phase 9 audit): DashboardPage and ReportsPage are the only
// two routes that pull in recharts (charting) and/or xlsx (spreadsheet
// export) -- both genuinely heavy libraries. Before this change, EVERY
// route in this file was a static top-level import, so the entire app
// bundled into a single ~2.78MB JS chunk (confirmed by inspecting the
// actual `npm run build` output, not assumed) -- meaning every single
// app launch paid the parse/eval cost of recharts+xlsx even for someone
// who goes straight to, say, Products and never opens Dashboard or
// Reports at all. Converting just these two to React.lazy() (not all ~30
// routes -- a full app-wide code-split is a much larger, more invasive
// change than this audit's scope justifies, and these two are where the
// actual heavy dependencies live) moves recharts/xlsx into their own
// async chunk(s), fetched only when a person actually navigates to one
// of these two pages. Every other route, guard, and piece of routing
// behavior below is unchanged -- only these two imports and their route
// elements.
const DashboardPage = lazy(() => import("@/pages/dashboard-page"));
const ReportsPage = lazy(() => import("@/pages/reports-page"));

// Minimal, unobtrusive fallback -- matches the existing plain-text
// loading pattern already used elsewhere in this app (see
// src/components/license/license-gate.tsx's "Loading…" state) rather
// than introducing a new spinner component just for this.
function RouteLoadingFallback(): JSX.Element {
  return <div className="mbs-route-loading">Loading…</div>;
}

import CustomersPage from "@/pages/customers-page";
import ProductsPage from "@/pages/products-page";
import ProductDetailsPage from "@/pages/product-details-page";
import OrdersPage from "@/pages/orders-page";
import InventoryPage from "@/pages/inventory-page";
import InvoicesPage from "@/pages/invoices-page";
import CertificatesPage from "@/pages/certificates-page";
import EmployeesPage from "@/pages/employees-page";
import AccountingPage from "@/pages/accounting-page";
import SettingsPage from "@/pages/settings-page";
import CompanyProfilePage from "@/pages/settings/company-profile";
import FinancialInvoicePage from "@/pages/settings/financial-invoice";
import CertificateSettingsPage from "@/pages/settings/certificate-settings";
import LocalizationPage from "@/pages/settings/localization";
import UserManagementPage from "@/pages/settings/user-management";
import FinanceAccountingPage from "@/pages/settings/finance-accounting";
import InventorySettingsPage from "@/pages/settings/inventory-settings";
import SalesPurchasePage from "@/pages/settings/sales-purchase";
import HrPayrollPage from "@/pages/settings/hr-payroll";
import SecuritySettingsPage from "@/pages/settings/security-settings";
import NotificationsPage from "@/pages/settings/notifications";
import IntegrationsPage from "@/pages/settings/integrations";
import DocumentTemplatesPage from "@/pages/settings/document-templates";
import DatabaseSettingsPage from "@/pages/settings/database-settings";
import LicenseSettingsPage from "@/pages/settings/license-settings";
import AboutPage from "@/pages/settings/about";


export const routes: RouteObject[] = [

  {
    path: "/",

    element: <AppLayout />,

    children: [

      {
        index: true,

        element: <RequireModuleAccess module="dashboard"><Suspense fallback={<RouteLoadingFallback />}><DashboardPage /></Suspense></RequireModuleAccess>
      },


      {
        path: "customers",

        element: <RequireModuleAccess module="customers"><CustomersPage /></RequireModuleAccess>
      },


      {
        path: "products",

        element: <RequireModuleAccess module="products"><ProductsPage /></RequireModuleAccess>
      },


      {
        path: "product-details",

        element: <RequireModuleAccess module="products"><ProductDetailsPage /></RequireModuleAccess>
      },


      {
        path: "inventory",

        element: <RequireModuleAccess module="products"><InventoryPage /></RequireModuleAccess>
      },


      {
        path: "orders",

        element: <RequireModuleAccess module="orders"><OrdersPage /></RequireModuleAccess>
      },


      {
        path: "invoices",

        element: <RequireModuleAccess module="invoices"><InvoicesPage /></RequireModuleAccess>
      },


      {
        path: "accounting",

        element: <RequireModuleAccess module="accounting"><AccountingPage /></RequireModuleAccess>
      },


      {
        path: "reports",

        element: <RequireModuleAccess module="reports"><Suspense fallback={<RouteLoadingFallback />}><ReportsPage /></Suspense></RequireModuleAccess>
      },


      {
        path: "certificates",

        element: <RequireModuleAccess module="certificates"><CertificatesPage /></RequireModuleAccess>
      },


      {
  path: "employees",

  element: <RequireModuleAccess module="employees">
    <EmployeesPage />
  </RequireModuleAccess>
},

{
  path: "profile",

  element: <ProfilePage />
},

{
  path: "change-password",

  element: <ChangePasswordPage />
},

{
  path: "settings",

  element: <RequireModuleAccess module="settings">
    <SettingsPage />
  </RequireModuleAccess>
},


      {
        path: "settings/company-profile",

        element: <RequireModuleAccess module="settings"><CompanyProfilePage /></RequireModuleAccess>
      },


      {
        path: "settings/financial-invoice",

        element: <RequireModuleAccess module="settings"><FinancialInvoicePage /></RequireModuleAccess>
      },


      {
        path: "settings/certificate-settings",

        element: <RequireModuleAccess module="settings"><CertificateSettingsPage /></RequireModuleAccess>
      },


      {
        path: "settings/localization",

        element: <RequireModuleAccess module="settings"><LocalizationPage /></RequireModuleAccess>
      },


      {
        path: "settings/user-management",

        element: <RequireModuleAccess module="settings"><RequireBusinessMode requires="enterprise"><UserManagementPage /></RequireBusinessMode></RequireModuleAccess>
      },


      {
        path: "settings/finance-accounting",

        element: <RequireModuleAccess module="settings"><FinanceAccountingPage /></RequireModuleAccess>
      },


      {
        path: "settings/inventory-settings",

        element: <RequireModuleAccess module="settings"><InventorySettingsPage /></RequireModuleAccess>
      },


      {
        path: "settings/sales-purchase",

        element: <RequireModuleAccess module="settings"><SalesPurchasePage /></RequireModuleAccess>
      },


      {
        path: "settings/hr-payroll",

        element: <RequireModuleAccess module="settings"><HrPayrollPage /></RequireModuleAccess>
      },


      {
        path: "settings/security-settings",

        element: <RequireModuleAccess module="settings"><SecuritySettingsPage /></RequireModuleAccess>
      },


      {
        path: "settings/notifications",

        element: <RequireModuleAccess module="settings"><NotificationsPage /></RequireModuleAccess>
      },


      {
        path: "settings/integrations",

        element: <RequireModuleAccess module="settings"><IntegrationsPage /></RequireModuleAccess>
      },


      {
        path: "settings/document-templates",

        element: <RequireModuleAccess module="settings"><DocumentTemplatesPage /></RequireModuleAccess>
      },


      {
        path: "settings/database-settings",

        element: <RequireModuleAccess module="settings"><DatabaseSettingsPage /></RequireModuleAccess>
      },


      {
        path: "settings/license-settings",

        element: <RequireModuleAccess module="settings"><LicenseSettingsPage /></RequireModuleAccess>
      },


      {
        path: "settings/about",

        element: <RequireModuleAccess module="settings"><AboutPage /></RequireModuleAccess>
      }


    ]

  }

];