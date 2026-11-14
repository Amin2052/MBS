import { DEFAULT_LANGUAGE } from "@/i18n";
import { DEFAULT_CURRENCY } from "@/constants/currency";
import { DEFAULT_THEME } from "@/constants/theme";

import type { CompanySettings } from "@/types/company-settings";
import type { ThemeMode } from "@/types/theme";

export const COMPANY_SETTINGS_STORAGE_KEY = "mooral.company-settings";

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  companyName: "Mooral Business Suite",
  logoPath: null,
  phone: "",
  email: "",
  address: "",
  website: "",
  taxId: "",
  currency: DEFAULT_CURRENCY,
  language: DEFAULT_LANGUAGE,
  theme: DEFAULT_THEME as ThemeMode,
  taxRate: 0,
  invoicePrefix: "INV-",
  invoiceFooter: "Thank you for your business.",
  paymentTerms: "Payment due within 30 days.",
  timezone: "Asia/Dhaka",
  hasLogo: false,
  certificateEmployeePrefix: "EMP-",
  certificateProductPrefix: "PRD-",
  certificateAutoNumbering: true,
  certificateQrVerification: true,
  certificateAuthorizedSignature: "",
  certificateAuthorizedDesignation: "",
  certificateFooterText: "",
  certificateEnableExpiry: false,
  certificateDefaultValidityDays: 0,
  certificateDefaultTemplate: "classic",
  certificateReuseCompanyLogo: true,

  stockLowThreshold: 10,
  stockDefaultWarehouse: "Main Warehouse",
  stockAllowNegative: false,
  stockAutoReorderAlert: true,

  salesOrderPrefix: "ORD-",
  purchaseOrderPrefix: "PO-",
  salesDefaultPaymentTerms: "Due on Receipt",
  purchaseDefaultPaymentTerms: "Net 30",
  salesRequireApproval: false,

  fiscalYearStart: "01-01",
  accountingDefaultTaxRate: 0,
  accountingDefaultPaymentMethod: "Cash",
  accountingAutoPostJournal: true,

  payrollPayDay: 1,
  payrollSalaryCycle: "Monthly",
  employeeProbationDays: 90,
  payrollOvertimeRate: 1.5,

  notifyEmailEnabled: true,
  notifyLowStock: true,
  notifyOrderUpdates: true,
  notifyPaymentDue: true,

  integrationApiKey: "",
  integrationWebhookUrl: "",
  integrationEnabled: false,

  invoiceTemplateStyle: "classic",
  reportTemplateStyle: "classic",
  documentShowLogo: true,

  dateFormat: "DMY",
  numberFormat: "en-US"
};
