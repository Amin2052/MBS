import type { LanguageCode } from "@/i18n";
import type { CurrencyCode } from "@/types/currency";
import type { ThemeMode } from "@/types/theme";


export interface CompanySettings {

  companyName: string;

  /**
   * Legacy field. No longer an actual filesystem path.
   * Once a logo exists in the database it is set to a non-empty
   * marker string (kept only so older truthy checks, e.g. in the
   * invoice PDF builder, keep working). Use `hasLogo` for new code.
   */
  logoPath: string | null;

  phone: string;

  email: string;

  address: string;

  website: string;

  /** Tax / VAT registration number (maps to company_settings.bin_vat) */
  taxId: string;


  currency: CurrencyCode;

  language: LanguageCode;

  theme: ThemeMode;


  taxRate: number;

  invoicePrefix: string;

  invoiceFooter: string;

  paymentTerms: string;


  timezone: string;

  /** True when a logo is stored in SQLite. Preferred over `logoPath`. */
  hasLogo?: boolean;


  // Certificate module configuration (Settings > Certificate).
  // Certificate PDFs reuse the company logo above unless
  // certificateReuseCompanyLogo is turned off.

  /** Prefix used when generating Employee certificate numbers, e.g. "EMP-". */
  certificateEmployeePrefix: string;

  /** Prefix used when generating Product certificate numbers, e.g. "PRD-". */
  certificateProductPrefix: string;

  /** When true, certificate numbers are generated automatically. */
  certificateAutoNumbering: boolean;

  /** When true, certificate PDFs include a verification QR code. */
  certificateQrVerification: boolean;

  /** Name printed on the authorized signature line. */
  certificateAuthorizedSignature: string;

  /** Designation/title printed under the authorized signature name. */
  certificateAuthorizedDesignation: string;

  /** Footer text printed on certificate PDFs. */
  certificateFooterText: string;

  /** When true, certificates get an expiry date by default. */
  certificateEnableExpiry: boolean;

  /** Default validity in days, used when certificateEnableExpiry is on. */
  certificateDefaultValidityDays: number;

  /** Reserved for future template choices; only "classic" exists today. */
  certificateDefaultTemplate: string;

  /** When true (default), certificate PDFs print the company logo. */
  certificateReuseCompanyLogo: boolean;


  // Inventory & Warehouse (Settings > Stock Settings)

  /** Default low-stock threshold used when a product has none set. */
  stockLowThreshold: number;

  /** Name of the default warehouse new stock is received into. */
  stockDefaultWarehouse: string;

  /** When true, stock levels are allowed to go negative. */
  stockAllowNegative: boolean;

  /** When true, low-stock alerts/notifications are generated automatically. */
  stockAutoReorderAlert: boolean;


  // Sales & Purchase (Settings > Sales & Purchase)

  /** Prefix used when generating new Sales Order numbers, e.g. "ORD-". */
  salesOrderPrefix: string;

  /** Prefix used when generating new Purchase Order numbers, e.g. "PO-". */
  purchaseOrderPrefix: string;

  /** Default payment terms shown/applied on new sales orders. */
  salesDefaultPaymentTerms: string;

  /** Default payment terms shown/applied on new purchase orders. */
  purchaseDefaultPaymentTerms: string;

  /** When true, new orders require Administrator/Owner approval before confirmation. */
  salesRequireApproval: boolean;


  // Finance & Accounting (Settings > Accounting Preferences)

  /** Fiscal year start, stored as "MM-DD", e.g. "01-01" for 1 January. */
  fiscalYearStart: string;

  /** Default tax rate (%) applied to new accounting entries. */
  accountingDefaultTaxRate: number;

  /** Default payment method pre-selected on new transactions. */
  accountingDefaultPaymentMethod: string;

  /** When true, journal entries are posted automatically instead of held as drafts. */
  accountingAutoPostJournal: boolean;


  // HR & Payroll (Settings > HR & Payroll)

  /** Day of the month payroll is run/paid on (1-31). */
  payrollPayDay: number;

  /** Salary cycle used for payroll calculations. */
  payrollSalaryCycle: "Monthly" | "Weekly" | "Bi-Weekly";

  /** Default probation period (days) applied to newly hired employees. */
  employeeProbationDays: number;

  /** Overtime pay multiplier applied to the base hourly/daily rate. */
  payrollOvertimeRate: number;


  // Notifications (Settings > Notifications)

  /** Master toggle for email notifications. */
  notifyEmailEnabled: boolean;

  /** Notify when a product falls below its low-stock threshold. */
  notifyLowStock: boolean;

  /** Notify on order status changes (created, confirmed, shipped, etc.). */
  notifyOrderUpdates: boolean;

  /** Notify when an invoice/payment becomes due or overdue. */
  notifyPaymentDue: boolean;


  // Integrations (Settings > External Services)

  /** API key used to authenticate outgoing integration/webhook requests. */
  integrationApiKey: string;

  /** Webhook URL that receives integration event payloads. */
  integrationWebhookUrl: string;

  /** Master toggle for external service integrations. */
  integrationEnabled: boolean;


  // Document Templates (Settings > Document Templates)

  /** Visual style/template used for generated invoices. */
  invoiceTemplateStyle: string;

  /** Visual style/template used for generated reports. */
  reportTemplateStyle: string;

  /** When true, the company logo is printed on invoices/reports. */
  documentShowLogo: boolean;


  // Localization (Settings > Localization)

  /** Date display format: "DMY" (31 Dec 2026), "MDY" (12/31/2026), or "YMD" (2026-12-31). */
  dateFormat: "DMY" | "MDY" | "YMD";

  /** Locale used for number grouping/decimal separators (e.g. "en-US" -> 1,234.56, "de-DE" -> 1.234,56). */
  numberFormat: "en-US" | "en-IN" | "de-DE";

}