/**
 * Mooral Business Suite
 * Employee Certificate PDF Template
 *
 * Pure rendering layer only - no IPC, no database, no certificate-
 * numbering logic, no QR generation, no employee data fetching live
 * here; certificates-page.tsx owns all of that and hands this
 * function a plain data object.
 *
 * Visual design: cream page with a single simple navy border, a
 * very light dot-lattice background pattern, centered letterhead
 * (logo / name / address / phone / email), an uppercase serif
 * certificate title, an italic "To Whom It May Concern" subtitle, a
 * large bold employee name with the designation directly beneath
 * it, a centered certificate body, a bordered 4-column detail
 * strip, and - pinned to the bottom of the page - a real
 * high-resolution SVG verification QR bottom-left and a bare
 * signature line + caption bottom-right (no fabricated signatory
 * name). No footer text. Every value rendered comes from existing
 * certificate / company-settings data - nothing here is hardcoded
 * per-employee data or a new field.
 */

import { escapeHtml, joinHtml, renderPdfDocument } from "@/pdf/pdf-html";


export interface EmployeeCertificateDetailItem {
  label: string;
  value: string;
}


export interface EmployeeCertificateTemplateData {
  certificateId: string;
  /** cert.certificate_type || cert.title || "Certificate" - resolved by the caller. */
  certificateTitle: string;
  employeeName?: string | null;
  /** Designation snapshot, rendered directly under the employee name. */
  designation?: string | null;
  issueDateFormatted: string;
  validUntilFormatted?: string | null;
  /** Employee Number / Certificate Number / Issue Date / Service Duration - the 4-column info strip. */
  infoColumns: EmployeeCertificateDetailItem[];
  descriptionText: string;
  companyName: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  logoDataUrl?: string | null;
  /** Raw <svg>...</svg> markup for a real, scannable, lossless verification QR. */
  qrSvgMarkup?: string | null;
  footerText: string;
}


export function renderEmployeeCertificateHtml(
  data: EmployeeCertificateTemplateData
): string {
  const companyMetaHtml = joinHtml([
    data.companyAddress ? `<p class="company-meta">${escapeHtml(data.companyAddress)}</p>` : "",
    (data.companyPhone || data.companyEmail)
      ? `<p class="company-meta">${joinHtml([
          data.companyPhone ? escapeHtml(data.companyPhone) : "",
          (data.companyPhone && data.companyEmail) ? " &nbsp;|&nbsp; " : "",
          data.companyEmail ? escapeHtml(data.companyEmail) : "",
        ])}</p>`
      : "",
  ]);

  const infoColumnsHtml = joinHtml(
    data.infoColumns.map(
      col => `
      <div class="info-col">
        <p class="info-label">${escapeHtml(col.label)}</p>
        <p class="info-value">${escapeHtml(col.value)}</p>
      </div>`
    )
  );

  const body = `
<div class="page">
  <div class="bg-pattern"></div>
  <div class="frame"></div>

  <div class="content">
    <div class="letterhead">
      ${data.logoDataUrl ? `<img class="logo" src="${data.logoDataUrl}" alt="${escapeHtml(data.companyName)}" />` : ""}
      <p class="company-name">${escapeHtml(data.companyName)}</p>
      ${companyMetaHtml}
    </div>

    <div class="rule-row"><span class="rule"></span><span class="rule-dot">&#10022;</span><span class="rule"></span></div>
    <h1 class="title">${escapeHtml(data.certificateTitle)}</h1>
    <div class="rule-row"><span class="rule"></span><span class="rule-dot">&#10022;</span><span class="rule"></span></div>

    <p class="subtitle">To Whom It May Concern</p>

    ${data.employeeName ? `<h2 class="employee-name">${escapeHtml(data.employeeName)}</h2>` : ""}
    <div class="name-rule"></div>
    ${data.designation ? `<p class="designation">${escapeHtml(data.designation)}</p>` : ""}

    <p class="description">${escapeHtml(data.descriptionText)}</p>

    <div class="info-strip">
      ${infoColumnsHtml}
    </div>
  </div>

  <div class="sign-row">
    <div class="qr-block">
      ${data.qrSvgMarkup ?? ""}
      <p class="qr-caption">Verification</p>
    </div>
    <div class="sign-block">
      <div class="sign-line"></div>
      <p class="sign-caption">Signature</p>
    </div>
  </div>
</div>
`;

  const styles = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#FFFDF7;color:#172B4D;font-family:Georgia,'Times New Roman',serif;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
.page{width:210mm;min-height:297mm;height:auto;position:relative;overflow:visible;background:#FFFDF7 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
.bg-pattern{position:absolute;inset:0;background-image:radial-gradient(#172B4D 0.4px,transparent 0.4px);background-size:6mm 6mm;opacity:.045;pointer-events:none}
.frame{position:absolute;inset:8mm;border:.5mm solid #172B4D;pointer-events:none}
.content{position:relative;padding:20mm 26mm 0;text-align:center}
.letterhead{display:flex;flex-direction:column;align-items:center}
.logo{max-height:32mm;max-width:80mm;width:auto;height:auto;object-fit:contain;margin-bottom:3mm}
.company-name{margin:0;font-size:19pt;font-weight:700;letter-spacing:.3px;color:#172B4D}
.company-meta{margin:1.5mm 0 0;font-size:8.3pt;color:#475467;font-family:Arial,Helvetica,sans-serif}
.rule-row{display:flex;align-items:center;justify-content:center;gap:3mm;margin:5mm auto 0;max-width:130mm}
.rule{flex:1;border-top:.5px solid #B08D4B}
.rule-dot{font-size:8pt;color:#B08D4B}
.title{margin:4mm 0 0;font-size:25pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#172B4D}
.subtitle{margin:6mm 0 0;font-size:11.5pt;font-style:italic;color:#344054}
.employee-name{margin:5mm 0 0;font-size:27pt;font-weight:700;color:#0F2038;letter-spacing:.3px}
.name-rule{margin:2.5mm auto 0;width:60mm;border-top:.5px solid #B08D4B}
.designation{margin:3mm 0 0;font-size:11pt;font-weight:700;color:#172B4D;font-family:Arial,Helvetica,sans-serif}
.description{margin:6mm auto 0;max-width:148mm;font-size:9.6pt;line-height:1.7;color:#344054;font-family:Arial,Helvetica,sans-serif}
.info-strip{margin:7mm auto 0;max-width:168mm;display:flex;border:.4px solid #B08D4B}
.info-col{flex:1;padding:3.5mm 2mm;border-right:.4px solid #E4D9C4}
.info-col:last-child{border-right:0}
.info-label{margin:0;font-size:7.3pt;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#172B4D;font-family:Arial,Helvetica,sans-serif}
.info-value{margin:1.8mm 0 0;font-size:8.6pt;color:#1F2937;font-family:Arial,Helvetica,sans-serif}
.sign-row{position:absolute;left:26mm;right:26mm;bottom:14mm;display:flex;align-items:flex-end;justify-content:space-between;padding:0 4mm}
.qr-block{width:32mm;text-align:center}
.qr-block svg{width:26mm;height:26mm;display:block;margin:0 auto}
.qr-caption{margin:1.5mm 0 0;text-align:center;font-size:7pt;color:#667085;font-family:Arial,Helvetica,sans-serif}
.sign-block{width:55mm;text-align:center}
.sign-line{border-top:.6px solid #172B4D}
.sign-caption{margin:1.8mm 0 0;font-size:8.5pt;color:#172B4D;font-family:Arial,Helvetica,sans-serif}
`;
  return renderPdfDocument({
    title: data.certificateId,
    pageMargin: "0",
    styles,
    body,
  });
}
