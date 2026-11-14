import { app, nativeImage, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

import { getDatabase } from "../../src/database/database";

import {
  COMPANY_SETTINGS_STORAGE_KEY,
  DEFAULT_COMPANY_SETTINGS
} from "../../src/constants/company-settings";

import type {
  CompanySettings
} from "../../src/types/company-settings";

// ===================================================================
// Company Settings — SQLite-backed (Settings Dashboard redesign)
//
// Storage moved from a single JSON file in userData to the
// `company_settings` table (id = 1, single-row table) so the logo can
// live inside the database as a BLOB instead of a filesystem path.
//
// A one-time migration copies any pre-existing JSON settings file
// (and, if present, its filesystem logo) into SQLite the first time
// this service runs on an existing install. The legacy JSON reader is
// kept around (not deleted) purely to support that migration; nothing
// writes to the JSON file anymore once migration has happened.
// ===================================================================

const LOGO_MAX_DIMENSION = 512;

interface CompanySettingsRow {
  company_name: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  bin_vat: string;
  currency: string;
  language: string;
  theme: string;
  tax_rate: number;
  invoice_prefix: string;
  invoice_footer: string;
  payment_terms: string;
  timezone: string;
  logo_blob: Buffer | null;
  logo_mime: string | null;
  certificate_employee_prefix: string;
  certificate_product_prefix: string;
  certificate_auto_numbering: number;
  certificate_qr_verification: number;
  certificate_authorized_signature: string;
  certificate_authorized_designation: string;
  certificate_footer_text: string;
  certificate_enable_expiry: number;
  certificate_default_validity_days: number;
  certificate_default_template: string;
  certificate_reuse_company_logo: number;

  stock_low_threshold: number;
  stock_default_warehouse: string;
  stock_allow_negative: number;
  stock_auto_reorder_alert: number;

  sales_order_prefix: string;
  purchase_order_prefix: string;
  sales_default_payment_terms: string;
  purchase_default_payment_terms: string;
  sales_require_approval: number;

  fiscal_year_start: string;
  accounting_default_tax_rate: number;
  accounting_default_payment_method: string;
  accounting_auto_post_journal: number;

  payroll_pay_day: number;
  payroll_salary_cycle: string;
  employee_probation_days: number;
  payroll_overtime_rate: number;

  notify_email_enabled: number;
  notify_low_stock: number;
  notify_order_updates: number;
  notify_payment_due: number;

  integration_api_key: string;
  integration_webhook_url: string;
  integration_enabled: number;

  invoice_template_style: string;
  report_template_style: string;
  document_show_logo: number;

  date_format: string;
  number_format: string;
}

function getLegacyJsonPath(): string {
  return path.join(
    app.getPath("userData"),
    `${COMPANY_SETTINGS_STORAGE_KEY}.json`
  );
}

/**
 * Reads the old JSON settings file, if it still exists. Used only by
 * the migration routine below — nothing else should call this.
 */
function readLegacyJsonSettings(): Partial<CompanySettings> & { logoPath?: string | null } | null {

  try {

    const filePath = getLegacyJsonPath();

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Partial<CompanySettings> & { logoPath?: string | null };

  }
  catch {

    return null;

  }

}

/**
 * Reads a legacy on-disk logo file and returns a resized PNG buffer,
 * or null if the file is missing / unreadable / not an image.
 */
function readLegacyLogoAsBuffer(logoPath: string): Buffer | null {

  try {

    if (!logoPath || !fs.existsSync(logoPath)) {
      return null;
    }

    const image = nativeImage.createFromPath(logoPath);

    if (image.isEmpty()) {
      return null;
    }

    return resizeImageToPng(image);

  }
  catch {

    return null;

  }

}

// Exported (rather than kept module-private) so other per-record photo
// features -- currently just Employee Photo -- can reuse the exact same
// resize/compress behavior instead of duplicating it. See
// electron/main/employee-photo-service.ts.
export function resizeImageToPng(image: Electron.NativeImage): Buffer {

  const { width, height } = image.getSize();

  if (width > LOGO_MAX_DIMENSION || height > LOGO_MAX_DIMENSION) {

    const aspectRatio = width / height;

    const targetSize = aspectRatio >= 1
      ? { width: LOGO_MAX_DIMENSION, height: Math.round(LOGO_MAX_DIMENSION / aspectRatio) }
      : { width: Math.round(LOGO_MAX_DIMENSION * aspectRatio), height: LOGO_MAX_DIMENSION };

    image = image.resize({
      ...targetSize,
      quality: "best"
    });

  }

  return image.toPNG();

}

/**
 * Runs once per app start (cheap existence check) and migrates any
 * legacy JSON settings + filesystem logo into SQLite. Safe to call
 * repeatedly: once the JSON file is renamed to `.migrated`, this is
 * a no-op on every subsequent call.
 */
function migrateLegacyJsonIfNeeded(): void {

  const legacyPath = getLegacyJsonPath();

  if (!fs.existsSync(legacyPath)) {
    return;
  }

  try {

    const legacy = readLegacyJsonSettings();

    if (legacy) {

      const db = getDatabase();

      db.prepare(`
        UPDATE company_settings
        SET
          company_name = COALESCE(NULLIF(?, ''), company_name),
          phone = COALESCE(NULLIF(?, ''), phone),
          email = COALESCE(NULLIF(?, ''), email),
          address = COALESCE(NULLIF(?, ''), address),
          currency = COALESCE(NULLIF(?, ''), currency),
          language = COALESCE(NULLIF(?, ''), language),
          theme = COALESCE(NULLIF(?, ''), theme),
          tax_rate = ?,
          invoice_prefix = COALESCE(NULLIF(?, ''), invoice_prefix),
          invoice_footer = COALESCE(NULLIF(?, ''), invoice_footer),
          payment_terms = COALESCE(NULLIF(?, ''), payment_terms),
          timezone = COALESCE(NULLIF(?, ''), timezone),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run(
        legacy.companyName ?? "",
        legacy.phone ?? "",
        legacy.email ?? "",
        legacy.address ?? "",
        legacy.currency ?? "",
        legacy.language ?? "",
        legacy.theme ?? "",
        legacy.taxRate ?? 0,
        legacy.invoicePrefix ?? "",
        legacy.invoiceFooter ?? "",
        legacy.paymentTerms ?? "",
        legacy.timezone ?? ""
      );

      // Migrate the old filesystem logo into the DB, once, if present.
      if (legacy.logoPath) {

        const logoBuffer = readLegacyLogoAsBuffer(legacy.logoPath);

        if (logoBuffer) {

          db.prepare(`
            UPDATE company_settings
            SET logo_blob = ?, logo_mime = 'image/png', updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
          `).run(logoBuffer);

        }

      }

    }

    // Keep the JSON file (per requirement: don't remove JSON support
    // immediately) but rename it so migration never re-runs and so
    // it's clearly marked as a superseded backup.
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);

  }
  catch (error) {

    console.error("Legacy company settings migration failed", error);

  }

}

// ===================================================================
// Integration API Key — encrypted at rest (Phase 8: Sensitive Data
// Storage). Uses the same Electron safeStorage (OS keychain/DPAPI/
// libsecret) pattern already established for the Remember Me session
// token (see electron/main/auth/session-storage.ts) rather than
// storing this credential as plaintext in the SQLite file. Degrades
// gracefully, same philosophy as Remember Me: if OS-level encryption
// isn't available (or a backup was restored on a different machine,
// where the OS keychain can't decrypt a value it didn't encrypt),
// the key simply comes back empty rather than corrupting the row or
// crashing -- the person just re-enters it once.
function encryptApiKey(plain: string): string {

  if (!plain) return "";

  if (!safeStorage.isEncryptionAvailable()) {
    return plain;
  }

  try {
    return safeStorage.encryptString(plain).toString("base64");
  } catch {
    return plain;
  }

}

function decryptApiKey(stored: string): string {

  if (!stored) return "";

  if (!safeStorage.isEncryptionAvailable()) {
    return stored;
  }

  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    // Not decryptable on this machine (different OS keychain, or the
    // value predates encryption and is still plaintext) -- degrade to
    // empty rather than surfacing an undecryptable blob as the "key".
    return "";
  }

}

function rowToCompanySettings(row: CompanySettingsRow): CompanySettings {

  const hasLogo = !!row.logo_blob;

  return {
    companyName: row.company_name || DEFAULT_COMPANY_SETTINGS.companyName,
    logoPath: hasLogo ? "stored-in-database" : null,
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    website: row.website || "",
    taxId: row.bin_vat || "",
    currency: (row.currency || DEFAULT_COMPANY_SETTINGS.currency) as CompanySettings["currency"],
    language: (row.language || DEFAULT_COMPANY_SETTINGS.language) as CompanySettings["language"],
    theme: (row.theme || DEFAULT_COMPANY_SETTINGS.theme) as CompanySettings["theme"],
    taxRate: row.tax_rate ?? 0,
    invoicePrefix: row.invoice_prefix || DEFAULT_COMPANY_SETTINGS.invoicePrefix,
    invoiceFooter: row.invoice_footer || "",
    paymentTerms: row.payment_terms || "",
    timezone: row.timezone || DEFAULT_COMPANY_SETTINGS.timezone,
    hasLogo,
    certificateEmployeePrefix: row.certificate_employee_prefix || DEFAULT_COMPANY_SETTINGS.certificateEmployeePrefix,
    certificateProductPrefix: row.certificate_product_prefix || DEFAULT_COMPANY_SETTINGS.certificateProductPrefix,
    certificateAutoNumbering: row.certificate_auto_numbering !== 0,
    certificateQrVerification: row.certificate_qr_verification !== 0,
    certificateAuthorizedSignature: row.certificate_authorized_signature || "",
    certificateAuthorizedDesignation: row.certificate_authorized_designation || "",
    certificateFooterText: row.certificate_footer_text || "",
    certificateEnableExpiry: row.certificate_enable_expiry === 1,
    certificateDefaultValidityDays: row.certificate_default_validity_days ?? 0,
    certificateDefaultTemplate: row.certificate_default_template || DEFAULT_COMPANY_SETTINGS.certificateDefaultTemplate,
    certificateReuseCompanyLogo: row.certificate_reuse_company_logo !== 0,

    stockLowThreshold: row.stock_low_threshold ?? DEFAULT_COMPANY_SETTINGS.stockLowThreshold,
    stockDefaultWarehouse: row.stock_default_warehouse || DEFAULT_COMPANY_SETTINGS.stockDefaultWarehouse,
    stockAllowNegative: row.stock_allow_negative === 1,
    stockAutoReorderAlert: row.stock_auto_reorder_alert !== 0,

    salesOrderPrefix: row.sales_order_prefix || DEFAULT_COMPANY_SETTINGS.salesOrderPrefix,
    purchaseOrderPrefix: row.purchase_order_prefix || DEFAULT_COMPANY_SETTINGS.purchaseOrderPrefix,
    salesDefaultPaymentTerms: row.sales_default_payment_terms || DEFAULT_COMPANY_SETTINGS.salesDefaultPaymentTerms,
    purchaseDefaultPaymentTerms: row.purchase_default_payment_terms || DEFAULT_COMPANY_SETTINGS.purchaseDefaultPaymentTerms,
    salesRequireApproval: row.sales_require_approval === 1,

    fiscalYearStart: row.fiscal_year_start || DEFAULT_COMPANY_SETTINGS.fiscalYearStart,
    accountingDefaultTaxRate: row.accounting_default_tax_rate ?? DEFAULT_COMPANY_SETTINGS.accountingDefaultTaxRate,
    accountingDefaultPaymentMethod: row.accounting_default_payment_method || DEFAULT_COMPANY_SETTINGS.accountingDefaultPaymentMethod,
    accountingAutoPostJournal: row.accounting_auto_post_journal !== 0,

    payrollPayDay: row.payroll_pay_day ?? DEFAULT_COMPANY_SETTINGS.payrollPayDay,
    payrollSalaryCycle: (row.payroll_salary_cycle || DEFAULT_COMPANY_SETTINGS.payrollSalaryCycle) as CompanySettings["payrollSalaryCycle"],
    employeeProbationDays: row.employee_probation_days ?? DEFAULT_COMPANY_SETTINGS.employeeProbationDays,
    payrollOvertimeRate: row.payroll_overtime_rate ?? DEFAULT_COMPANY_SETTINGS.payrollOvertimeRate,

    notifyEmailEnabled: row.notify_email_enabled !== 0,
    notifyLowStock: row.notify_low_stock !== 0,
    notifyOrderUpdates: row.notify_order_updates !== 0,
    notifyPaymentDue: row.notify_payment_due !== 0,

    integrationApiKey: decryptApiKey(row.integration_api_key || ""),
    integrationWebhookUrl: row.integration_webhook_url || "",
    integrationEnabled: row.integration_enabled === 1,

    invoiceTemplateStyle: row.invoice_template_style || DEFAULT_COMPANY_SETTINGS.invoiceTemplateStyle,
    reportTemplateStyle: row.report_template_style || DEFAULT_COMPANY_SETTINGS.reportTemplateStyle,
    documentShowLogo: row.document_show_logo !== 0,

    dateFormat: (row.date_format || DEFAULT_COMPANY_SETTINGS.dateFormat) as CompanySettings["dateFormat"],
    numberFormat: (row.number_format || DEFAULT_COMPANY_SETTINGS.numberFormat) as CompanySettings["numberFormat"]
  };

}

export function getCompanySettings(): CompanySettings {

  try {

    migrateLegacyJsonIfNeeded();

    const db = getDatabase();

    const row = db
      .prepare("SELECT * FROM company_settings WHERE id = 1")
      .get() as CompanySettingsRow | undefined;

    if (!row) {
      return { ...DEFAULT_COMPANY_SETTINGS };
    }

    return rowToCompanySettings(row);

  }
  catch (error) {

    console.error("Failed to read company settings", error);

    return { ...DEFAULT_COMPANY_SETTINGS };

  }

}

export function updateCompanySettings(
  patch: Partial<CompanySettings>
): CompanySettings {

  const db = getDatabase();

  db.prepare(`
    UPDATE company_settings
    SET
      company_name = COALESCE(?, company_name),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      address = COALESCE(?, address),
      website = COALESCE(?, website),
      bin_vat = COALESCE(?, bin_vat),
      currency = COALESCE(?, currency),
      language = COALESCE(?, language),
      theme = COALESCE(?, theme),
      tax_rate = COALESCE(?, tax_rate),
      invoice_prefix = COALESCE(?, invoice_prefix),
      invoice_footer = COALESCE(?, invoice_footer),
      payment_terms = COALESCE(?, payment_terms),
      timezone = COALESCE(?, timezone),
      certificate_employee_prefix = COALESCE(?, certificate_employee_prefix),
      certificate_product_prefix = COALESCE(?, certificate_product_prefix),
      certificate_auto_numbering = COALESCE(?, certificate_auto_numbering),
      certificate_qr_verification = COALESCE(?, certificate_qr_verification),
      certificate_authorized_signature = COALESCE(?, certificate_authorized_signature),
      certificate_authorized_designation = COALESCE(?, certificate_authorized_designation),
      certificate_footer_text = COALESCE(?, certificate_footer_text),
      certificate_enable_expiry = COALESCE(?, certificate_enable_expiry),
      certificate_default_validity_days = COALESCE(?, certificate_default_validity_days),
      certificate_default_template = COALESCE(?, certificate_default_template),
      certificate_reuse_company_logo = COALESCE(?, certificate_reuse_company_logo),
      stock_low_threshold = COALESCE(?, stock_low_threshold),
      stock_default_warehouse = COALESCE(?, stock_default_warehouse),
      stock_allow_negative = COALESCE(?, stock_allow_negative),
      stock_auto_reorder_alert = COALESCE(?, stock_auto_reorder_alert),
      sales_order_prefix = COALESCE(?, sales_order_prefix),
      purchase_order_prefix = COALESCE(?, purchase_order_prefix),
      sales_default_payment_terms = COALESCE(?, sales_default_payment_terms),
      purchase_default_payment_terms = COALESCE(?, purchase_default_payment_terms),
      sales_require_approval = COALESCE(?, sales_require_approval),
      fiscal_year_start = COALESCE(?, fiscal_year_start),
      accounting_default_tax_rate = COALESCE(?, accounting_default_tax_rate),
      accounting_default_payment_method = COALESCE(?, accounting_default_payment_method),
      accounting_auto_post_journal = COALESCE(?, accounting_auto_post_journal),
      payroll_pay_day = COALESCE(?, payroll_pay_day),
      payroll_salary_cycle = COALESCE(?, payroll_salary_cycle),
      employee_probation_days = COALESCE(?, employee_probation_days),
      payroll_overtime_rate = COALESCE(?, payroll_overtime_rate),
      notify_email_enabled = COALESCE(?, notify_email_enabled),
      notify_low_stock = COALESCE(?, notify_low_stock),
      notify_order_updates = COALESCE(?, notify_order_updates),
      notify_payment_due = COALESCE(?, notify_payment_due),
      integration_api_key = COALESCE(?, integration_api_key),
      integration_webhook_url = COALESCE(?, integration_webhook_url),
      integration_enabled = COALESCE(?, integration_enabled),
      invoice_template_style = COALESCE(?, invoice_template_style),
      report_template_style = COALESCE(?, report_template_style),
      document_show_logo = COALESCE(?, document_show_logo),
      date_format = COALESCE(?, date_format),
      number_format = COALESCE(?, number_format),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    patch.companyName ?? null,
    patch.phone ?? null,
    patch.email ?? null,
    patch.address ?? null,
    patch.website ?? null,
    patch.taxId ?? null,
    patch.currency ?? null,
    patch.language ?? null,
    patch.theme ?? null,
    patch.taxRate ?? null,
    patch.invoicePrefix ?? null,
    patch.invoiceFooter ?? null,
    patch.paymentTerms ?? null,
    patch.timezone ?? null,
    patch.certificateEmployeePrefix ?? null,
    patch.certificateProductPrefix ?? null,
    patch.certificateAutoNumbering === undefined ? null : (patch.certificateAutoNumbering ? 1 : 0),
    patch.certificateQrVerification === undefined ? null : (patch.certificateQrVerification ? 1 : 0),
    patch.certificateAuthorizedSignature ?? null,
    patch.certificateAuthorizedDesignation ?? null,
    patch.certificateFooterText ?? null,
    patch.certificateEnableExpiry === undefined ? null : (patch.certificateEnableExpiry ? 1 : 0),
    patch.certificateDefaultValidityDays ?? null,
    patch.certificateDefaultTemplate ?? null,
    patch.certificateReuseCompanyLogo === undefined ? null : (patch.certificateReuseCompanyLogo ? 1 : 0),
    patch.stockLowThreshold ?? null,
    patch.stockDefaultWarehouse ?? null,
    patch.stockAllowNegative === undefined ? null : (patch.stockAllowNegative ? 1 : 0),
    patch.stockAutoReorderAlert === undefined ? null : (patch.stockAutoReorderAlert ? 1 : 0),
    patch.salesOrderPrefix ?? null,
    patch.purchaseOrderPrefix ?? null,
    patch.salesDefaultPaymentTerms ?? null,
    patch.purchaseDefaultPaymentTerms ?? null,
    patch.salesRequireApproval === undefined ? null : (patch.salesRequireApproval ? 1 : 0),
    patch.fiscalYearStart ?? null,
    patch.accountingDefaultTaxRate ?? null,
    patch.accountingDefaultPaymentMethod ?? null,
    patch.accountingAutoPostJournal === undefined ? null : (patch.accountingAutoPostJournal ? 1 : 0),
    patch.payrollPayDay ?? null,
    patch.payrollSalaryCycle ?? null,
    patch.employeeProbationDays ?? null,
    patch.payrollOvertimeRate ?? null,
    patch.notifyEmailEnabled === undefined ? null : (patch.notifyEmailEnabled ? 1 : 0),
    patch.notifyLowStock === undefined ? null : (patch.notifyLowStock ? 1 : 0),
    patch.notifyOrderUpdates === undefined ? null : (patch.notifyOrderUpdates ? 1 : 0),
    patch.notifyPaymentDue === undefined ? null : (patch.notifyPaymentDue ? 1 : 0),
    patch.integrationApiKey === undefined ? null : encryptApiKey(patch.integrationApiKey),
    patch.integrationWebhookUrl ?? null,
    patch.integrationEnabled === undefined ? null : (patch.integrationEnabled ? 1 : 0),
    patch.invoiceTemplateStyle ?? null,
    patch.reportTemplateStyle ?? null,
    patch.documentShowLogo === undefined ? null : (patch.documentShowLogo ? 1 : 0),
    patch.dateFormat ?? null,
    patch.numberFormat ?? null
  );

  return getCompanySettings();

}

export function resetCompanySettings(): CompanySettings {

  const db = getDatabase();

  db.prepare(`
    UPDATE company_settings
    SET
      company_name = ?,
      phone = ?,
      email = ?,
      address = ?,
      website = ?,
      bin_vat = ?,
      currency = ?,
      language = ?,
      theme = ?,
      tax_rate = ?,
      invoice_prefix = ?,
      invoice_footer = ?,
      payment_terms = ?,
      timezone = ?,
      logo_blob = NULL,
      logo_mime = NULL,
      certificate_employee_prefix = ?,
      certificate_product_prefix = ?,
      certificate_auto_numbering = ?,
      certificate_qr_verification = ?,
      certificate_authorized_signature = ?,
      certificate_authorized_designation = ?,
      certificate_footer_text = ?,
      certificate_enable_expiry = ?,
      certificate_default_validity_days = ?,
      certificate_default_template = ?,
      certificate_reuse_company_logo = ?,
      stock_low_threshold = ?,
      stock_default_warehouse = ?,
      stock_allow_negative = ?,
      stock_auto_reorder_alert = ?,
      sales_order_prefix = ?,
      purchase_order_prefix = ?,
      sales_default_payment_terms = ?,
      purchase_default_payment_terms = ?,
      sales_require_approval = ?,
      fiscal_year_start = ?,
      accounting_default_tax_rate = ?,
      accounting_default_payment_method = ?,
      accounting_auto_post_journal = ?,
      payroll_pay_day = ?,
      payroll_salary_cycle = ?,
      employee_probation_days = ?,
      payroll_overtime_rate = ?,
      notify_email_enabled = ?,
      notify_low_stock = ?,
      notify_order_updates = ?,
      notify_payment_due = ?,
      integration_api_key = ?,
      integration_webhook_url = ?,
      integration_enabled = ?,
      invoice_template_style = ?,
      report_template_style = ?,
      document_show_logo = ?,
      date_format = ?,
      number_format = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    DEFAULT_COMPANY_SETTINGS.companyName,
    DEFAULT_COMPANY_SETTINGS.phone,
    DEFAULT_COMPANY_SETTINGS.email,
    DEFAULT_COMPANY_SETTINGS.address,
    DEFAULT_COMPANY_SETTINGS.website,
    DEFAULT_COMPANY_SETTINGS.taxId,
    DEFAULT_COMPANY_SETTINGS.currency,
    DEFAULT_COMPANY_SETTINGS.language,
    DEFAULT_COMPANY_SETTINGS.theme,
    DEFAULT_COMPANY_SETTINGS.taxRate,
    DEFAULT_COMPANY_SETTINGS.invoicePrefix,
    DEFAULT_COMPANY_SETTINGS.invoiceFooter,
    DEFAULT_COMPANY_SETTINGS.paymentTerms,
    DEFAULT_COMPANY_SETTINGS.timezone,
    DEFAULT_COMPANY_SETTINGS.certificateEmployeePrefix,
    DEFAULT_COMPANY_SETTINGS.certificateProductPrefix,
    DEFAULT_COMPANY_SETTINGS.certificateAutoNumbering ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.certificateQrVerification ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.certificateAuthorizedSignature,
    DEFAULT_COMPANY_SETTINGS.certificateAuthorizedDesignation,
    DEFAULT_COMPANY_SETTINGS.certificateFooterText,
    DEFAULT_COMPANY_SETTINGS.certificateEnableExpiry ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.certificateDefaultValidityDays,
    DEFAULT_COMPANY_SETTINGS.certificateDefaultTemplate,
    DEFAULT_COMPANY_SETTINGS.certificateReuseCompanyLogo ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.stockLowThreshold,
    DEFAULT_COMPANY_SETTINGS.stockDefaultWarehouse,
    DEFAULT_COMPANY_SETTINGS.stockAllowNegative ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.stockAutoReorderAlert ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.salesOrderPrefix,
    DEFAULT_COMPANY_SETTINGS.purchaseOrderPrefix,
    DEFAULT_COMPANY_SETTINGS.salesDefaultPaymentTerms,
    DEFAULT_COMPANY_SETTINGS.purchaseDefaultPaymentTerms,
    DEFAULT_COMPANY_SETTINGS.salesRequireApproval ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.fiscalYearStart,
    DEFAULT_COMPANY_SETTINGS.accountingDefaultTaxRate,
    DEFAULT_COMPANY_SETTINGS.accountingDefaultPaymentMethod,
    DEFAULT_COMPANY_SETTINGS.accountingAutoPostJournal ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.payrollPayDay,
    DEFAULT_COMPANY_SETTINGS.payrollSalaryCycle,
    DEFAULT_COMPANY_SETTINGS.employeeProbationDays,
    DEFAULT_COMPANY_SETTINGS.payrollOvertimeRate,
    DEFAULT_COMPANY_SETTINGS.notifyEmailEnabled ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.notifyLowStock ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.notifyOrderUpdates ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.notifyPaymentDue ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.integrationApiKey,
    DEFAULT_COMPANY_SETTINGS.integrationWebhookUrl,
    DEFAULT_COMPANY_SETTINGS.integrationEnabled ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.invoiceTemplateStyle,
    DEFAULT_COMPANY_SETTINGS.reportTemplateStyle,
    DEFAULT_COMPANY_SETTINGS.documentShowLogo ? 1 : 0,
    DEFAULT_COMPANY_SETTINGS.dateFormat,
    DEFAULT_COMPANY_SETTINGS.numberFormat
  );

  return getCompanySettings();

}

/**
 * Resizes/compresses the given image buffer and stores it as the
 * single company logo in SQLite, replacing whatever logo (if any)
 * existed before. Returns a displayable data URL, or null on failure.
 */
export function saveCompanyLogoFromBuffer(fileBuffer: Buffer): string | null {

  try {

    const image = nativeImage.createFromBuffer(fileBuffer);

    if (image.isEmpty()) {
      return null;
    }

    const pngBuffer = resizeImageToPng(image);

    const db = getDatabase();

    db.prepare(`
      UPDATE company_settings
      SET logo_blob = ?, logo_mime = 'image/png', updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(pngBuffer);

    return `data:image/png;base64,${pngBuffer.toString("base64")}`;

  }
  catch (error) {

    console.error("Failed to save company logo", error);

    return null;

  }

}

/**
 * Removes the stored company logo (if any) by clearing logo_blob and
 * logo_mime in SQLite. Leaves every other company_settings field
 * untouched. Returns true on success, false on failure.
 */
export function removeCompanyLogo(): boolean {

  try {

    const db = getDatabase();

    db.prepare(`
      UPDATE company_settings
      SET logo_blob = NULL, logo_mime = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();

    return true;

  }
  catch (error) {

    console.error("Failed to remove company logo", error);

    return false;

  }

}

/**
 * Returns the current logo as a data URL, or null if none is stored.
 * The `legacyPath` argument is accepted only for backward
 * compatibility with existing callers (e.g. invoice PDF generation)
 * and is otherwise ignored — SQLite is always the source of truth.
 */
export function getCompanyLogoDataUrl(legacyPath?: string | null): string | null {

  try {

    const db = getDatabase();

    const row = db
      .prepare("SELECT logo_blob, logo_mime FROM company_settings WHERE id = 1")
      .get() as { logo_blob: Buffer | null; logo_mime: string | null } | undefined;

    if (row?.logo_blob) {
      return `data:${row.logo_mime || "image/png"};base64,${row.logo_blob.toString("base64")}`;
    }

    // Fallback for anything still holding an actual legacy filesystem
    // path that hasn't been migrated yet (defensive only).
    if (legacyPath && legacyPath !== "stored-in-database" && fs.existsSync(legacyPath)) {

      const image = nativeImage.createFromPath(legacyPath);
      return image.isEmpty() ? null : image.toDataURL();

    }

    return null;

  }
  catch (error) {

    console.error("Failed to read company logo", error);

    return null;

  }

}
