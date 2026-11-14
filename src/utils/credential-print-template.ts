import { getCompanySettings } from "@/services/company-settings-service";
import { PERMISSION_MODULES } from "@/auth/permission-catalog";
import { MOORAL_LOGO_DATA_URL } from "@/assets/mooral-logo-data-url";

function escapeHtml(value: string): string {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

}

export interface CredentialPrintParams {
  employeeName: string | null;
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  username: string;
  temporaryPassword: string;
  permissionProfileName: string | null;
  permissionKeys: string[];
  issuedBy: string;
}

/**
 * Builds the printable credential document per the Master Spec's
 * PRINT TEMPLATE section: Company Logo, Company Name, Employee Name,
 * Employee ID, Department, Designation, Username, Temporary Password,
 * Permission Summary, Issue Date, Issued By, Security Notice. Follows
 * the same build pattern as invoices-page.tsx's buildInvoiceHtml
 * (getCompanySettings + getLogoPreview + escapeHtml), scaled down for
 * this simpler single-page document.
 */
export async function buildCredentialHtml(params: CredentialPrintParams): Promise<string> {

  const company = await getCompanySettings();

  // Logo integration (branding task): same fallback rule as the
  // Invoice/Reports PDFs - if no company logo has been uploaded, use
  // the official Mooral Business Suite logo instead of leaving the
  // header logo slot empty. An uploaded company logo always takes
  // priority.
  const logoData = (company.logoPath
    ? await window.mooral.settings.getLogoPreview(company.logoPath)
    : null) ?? MOORAL_LOGO_DATA_URL;

  const issueDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const permissionRows = PERMISSION_MODULES
    .map(module => {

      const granted = params.permissionKeys.some(key => key.startsWith(`${module}.`));

      return `
        <div class="perm-row">
          <span class="perm-mark ${granted ? "perm-yes" : "perm-no"}">${granted ? "&#10003;" : "&#10007;"}</span>
          <span>${escapeHtml(module.charAt(0).toUpperCase() + module.slice(1))}</span>
        </div>
      `;

    })
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>

  @page { size: A4; margin: 24mm 20mm; }

  * { box-sizing: border-box; }

  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #111827;
    margin: 0;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 2px solid #111827;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }

  .header img {
    height: 56px;
    max-width: 160px;
    object-fit: contain;
  }

  .header h1 {
    font-size: 20px;
    margin: 0;
  }

  .header p {
    margin: 2px 0 0;
    color: #6b7280;
    font-size: 12px;
  }

  h2 {
    font-size: 15px;
    margin: 0 0 12px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 24px;
    margin-bottom: 24px;
  }

  .info-row span:first-child {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 2px;
  }

  .info-row span:last-child {
    font-size: 13px;
    font-weight: 600;
  }

  .credentials-box {
    border: 1px dashed #9ca3af;
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 24px;
  }

  .credentials-box .info-row {
    margin-bottom: 8px;
  }

  .perm-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px 24px;
    margin-bottom: 24px;
  }

  .perm-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .perm-mark {
    display: inline-flex;
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    font-size: 11px;
    color: #fff;
  }

  .perm-yes { background: #16a34a; }
  .perm-no { background: #d1d5db; color: #6b7280; }

  .footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #6b7280;
  }

  .footer strong {
    display: block;
    color: #111827;
    margin-bottom: 4px;
  }

</style>
</head>
<body>

  <div class="header">
    ${logoData ? `<img src="${logoData}" />` : ""}
    <div>
      <h1>${escapeHtml(company.companyName || "Company")}</h1>
      <p>Account Login Credentials</p>
    </div>
  </div>

  <h2>Account Holder</h2>
  <div class="info-grid">

    <div class="info-row">
      <span>Name</span>
      <span>${escapeHtml(params.employeeName ?? "-")}</span>
    </div>

    <div class="info-row">
      <span>Employee ID</span>
      <span>${escapeHtml(params.employeeId ?? "-")}</span>
    </div>

    <div class="info-row">
      <span>Department</span>
      <span>${escapeHtml(params.department ?? "-")}</span>
    </div>

    <div class="info-row">
      <span>Designation</span>
      <span>${escapeHtml(params.designation ?? "-")}</span>
    </div>

  </div>

  <h2>Login Credentials</h2>
  <div class="credentials-box">

    <div class="info-row">
      <span>Username</span>
      <span>${escapeHtml(params.username)}</span>
    </div>

    <div class="info-row">
      <span>Temporary Password</span>
      <span>${escapeHtml(params.temporaryPassword)}</span>
    </div>

    <div class="info-row">
      <span>Permission Profile</span>
      <span>${escapeHtml(params.permissionProfileName ?? "-")}</span>
    </div>

  </div>

  <h2>Permission Summary</h2>
  <div class="perm-grid">
    ${permissionRows}
  </div>

  <div class="footer">
    <strong>This temporary password must be changed during the first login.</strong>
    Issue Date: ${escapeHtml(issueDate)} &nbsp;&bull;&nbsp; Issued By: ${escapeHtml(params.issuedBy)}
  </div>

</body>
</html>
  `;

}
