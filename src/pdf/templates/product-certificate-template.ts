/**
 * Mooral Business Suite
 * Product Certificate PDF Template
 *
 * Self-contained A4 Product Certificate rendering layer.
 * All business data is supplied by certificates-page.tsx; this file only
 * turns that data into print/PDF-ready HTML.
 */

import { escapeHtml, joinHtml, renderPdfDocument } from "@/pdf/pdf-html";

export interface ProductCertificateDetailRow {
  label: string;
  value: string;
}

export interface ProductCertificateTemplateData {
  certificateId: string;
  certificateTypeLabel: string;
  productName?: string | null;
  customerName?: string | null;
  category?: string | null;
  sku?: string | null;
  serialNumber?: string | null;
  statusLabel?: string | null;
  issueDateFormatted?: string | null;
  expiryDateFormatted?: string | null;
  companyName: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  logoDataUrl?: string | null;
  detailRows: ProductCertificateDetailRow[];
  statementText: string;
  descriptionText?: string | null;
  qrDataUrl?: string | null;
  authorizedName: string;
  authorizedDesignation?: string;
  footerText: string;
}

function renderInfoCard(label: string, value?: string | null): string {
  if (!value) return "";
  return `
    <div class="info-card">
      <div class="info-label">${escapeHtml(label)}</div>
      <div class="info-value">${escapeHtml(value)}</div>
    </div>`;
}

export function renderProductCertificateHtml(
  data: ProductCertificateTemplateData
): string {
  const detailRowsHtml = joinHtml(
    data.detailRows.map(
      (row, index) => `
      <tr class="${index % 2 === 1 ? "alt" : ""}">
        <td class="detail-label">${escapeHtml(row.label)}</td>
        <td class="detail-value">${escapeHtml(row.value)}</td>
      </tr>`
    )
  );

  const metaLine = [
    data.certificateId ? `Certificate No. ${escapeHtml(data.certificateId)}` : "",
    data.issueDateFormatted ? `Issued ${escapeHtml(data.issueDateFormatted)}` : "",
  ].filter(Boolean).join(" &middot; ");

  const companyContactParts = [data.companyAddress, data.companyPhone, data.companyEmail]
    .filter(Boolean)
    .map(value => escapeHtml(value));
  const companyContact = companyContactParts
    .map(part => `<div class="contact-line">${part}</div>`)
    .join("");

  const statusClass = (data.statusLabel || "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "default";

  const body = `
<div class="page">
  <div class="top-accent"></div>
  <div class="outer-frame"></div>

  <div class="page-content">
    <header class="letterhead">
      <div class="brand-block">
        ${data.logoDataUrl ? `<img class="logo" src="${data.logoDataUrl}" alt="${escapeHtml(data.companyName)}" />` : ""}
        <div class="brand-text">
          <div class="company-name">${escapeHtml(data.companyName)}</div>
          ${companyContact ? `<div class="company-contact">${companyContact}</div>` : ""}
        </div>
      </div>

      <div class="document-chip">
        <div class="chip-caption">OFFICIAL DOCUMENT</div>
        <div class="chip-value">PRODUCT CERTIFICATE</div>
      </div>
    </header>

    <div class="header-divider"></div>

    <section class="hero">
      <div class="hero-kicker">${escapeHtml(data.certificateTypeLabel || "Product Certificate")}</div>
      <h1>Product Certificate</h1>
      <p class="hero-meta">${metaLine}</p>
    </section>

    <section class="product-panel">
      <div class="panel-heading">
        <div>
          <div class="section-kicker">CERTIFIED PRODUCT</div>
          <h2>${escapeHtml(data.productName || "Product")}</h2>
        </div>
        ${data.statusLabel ? `<span class="status status-${statusClass}">${escapeHtml(data.statusLabel)}</span>` : ""}
      </div>

      <div class="info-grid">
        ${renderInfoCard("Customer", data.customerName)}
        ${renderInfoCard("Category", data.category)}
        ${renderInfoCard("SKU", data.sku)}
        ${renderInfoCard("Serial Number", data.serialNumber)}
      </div>
    </section>

    <section class="details-section">
      <div class="section-title-row">
        <div class="section-kicker">CERTIFICATE DETAILS</div>
        ${data.expiryDateFormatted ? `<div class="validity">Valid through <strong>${escapeHtml(data.expiryDateFormatted)}</strong></div>` : ""}
      </div>
      <table class="detail-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>${detailRowsHtml}</tbody>
      </table>
    </section>

    <section class="statement-section">
      <div class="section-kicker">CERTIFICATION STATEMENT</div>
      <p class="statement">${escapeHtml(data.statementText)}</p>
      ${data.descriptionText ? `<p class="description">${escapeHtml(data.descriptionText)}</p>` : ""}
    </section>

    <section class="assurance-row">
      <div class="assurance-box">
        <div class="assurance-icon">✓</div>
        <div>
          <div class="assurance-title">Document authenticity</div>
          <div class="assurance-text">Scan the QR code to verify this certificate.</div>
        </div>
      </div>
      ${data.issueDateFormatted || data.expiryDateFormatted ? `
      <div class="validity-box">
        <div class="validity-label">Validity</div>
        <div class="validity-value">${escapeHtml(data.issueDateFormatted || "")}${data.expiryDateFormatted ? ` <span>→</span> ${escapeHtml(data.expiryDateFormatted)}` : ""}</div>
      </div>` : ""}
    </section>
  </div>

  <footer class="footer-area">
    ${data.qrDataUrl ? `
    <div class="qr-area">
      <img class="qr" src="${data.qrDataUrl}" alt="Certificate verification QR code" />
      <div class="qr-copy">
      </div>
    </div>` : ""}

    <div class="signatory">
      <div class="signature-space"></div>
      <div class="signature-line"></div>
      <div class="signature-name">${escapeHtml(data.authorizedName)}</div>
      ${data.authorizedDesignation ? `<div class="signature-role">${escapeHtml(data.authorizedDesignation)}</div>` : ""}
    </div>
  </footer>
</div>`;

  const styles = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#f3f5f8;color:#172033;font-family:Arial,Helvetica,sans-serif}
.page{width:210mm;min-height:297mm;height:auto;position:relative;overflow:visible;background:#fff}
.top-accent{position:absolute;left:0;top:0;right:0;height:3.2mm;background:#172033}
.outer-frame{position:absolute;inset:8mm;border:1px solid #d9dee7;pointer-events:none}
.page-content{position:relative;padding:14mm 15mm 44mm 15mm}
.letterhead{display:flex;justify-content:space-between;align-items:center;gap:8mm}
.brand-block{display:flex;align-items:center;gap:1.5mm;min-width:0}
.logo{width:22mm;height:22mm;object-fit:contain;display:block}
.brand-text{min-width:0}
.company-name{font-size:14pt;font-weight:800;letter-spacing:.15px;color:#172033}
.company-contact{margin-top:1.3mm;font-size:6.8pt;line-height:1.45;color:#6b7280}
.contact-line{white-space:nowrap}
.document-chip{padding:3mm 4mm;border:1px solid #d8dde6;border-radius:2mm;text-align:right;background:#fafbfc}
.chip-caption{font-size:5.8pt;letter-spacing:1.2px;color:#7a8494;font-weight:800}
.chip-value{margin-top:1.2mm;font-size:7.1pt;letter-spacing:.7px;color:#172033;font-weight:800}
.header-divider{margin-top:5mm;border-top:1px solid #d6dbe4}
.hero{text-align:center;padding-top:8mm}
.hero-kicker{font-size:7pt;font-weight:800;letter-spacing:1.2px;color:#52627a;text-transform:uppercase}
.hero h1{margin:2mm 0 0;font-size:25pt;line-height:1.08;font-weight:800;color:#111827;letter-spacing:.2px}
.hero-meta{margin:2.5mm 0 0;font-size:7.2pt;color:#7a8494}
.product-panel{margin-top:7mm;border:1px solid #d7dde6;border-radius:2.5mm;background:#fbfcfe;padding:5mm}
.panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm}
.section-kicker{font-size:6.4pt;line-height:1.2;font-weight:800;letter-spacing:1px;color:#6b7280;text-transform:uppercase}
.product-panel h2{margin:1.8mm 0 0;font-size:16pt;line-height:1.15;color:#172033}
.status{display:inline-flex;align-items:center;padding:1.8mm 3mm;border:1px solid #d7dde6;border-radius:999px;font-size:6.5pt;line-height:1;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#344054;background:#fff;white-space:nowrap}
.status-active{color:#1f5f3b;border-color:#bddbc9;background:#f4fbf7}.status-expired{color:#8a4b19;border-color:#e8cfb6;background:#fff9f3}.status-revoked{color:#8b2733;border-color:#e8c1c7;background:#fff7f8}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:2.2mm;margin-top:4.5mm}
.info-card{min-height:15mm;padding:3mm;border:1px solid #e0e5ec;background:#fff;border-radius:1.5mm}
.info-label{font-size:5.7pt;line-height:1.2;letter-spacing:.7px;text-transform:uppercase;color:#8a94a3;font-weight:800}
.info-value{margin-top:1.5mm;font-size:7.5pt;line-height:1.35;font-weight:700;color:#273244;overflow-wrap:anywhere}
.details-section{margin-top:6.5mm}
.section-title-row{display:flex;justify-content:space-between;align-items:end;gap:4mm;margin-bottom:2.5mm}
.validity{font-size:6.6pt;color:#7b8491}.validity strong{color:#273244}
.detail-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:7.3pt}
.detail-table thead th{padding:2.3mm 3mm;background:#172033;color:#fff;text-align:left;font-size:6.4pt;letter-spacing:.7px;text-transform:uppercase}
.detail-table thead th:first-child{width:35%}
.detail-table tbody td{padding:2.2mm 3mm;border:1px solid #e0e5ec;line-height:1.3;vertical-align:middle}
.detail-table tbody tr.alt{background:#fafbfd}
.detail-label{font-weight:700;color:#596474}.detail-value{font-weight:700;color:#1f2937}
.statement-section{margin-top:6.5mm}
.statement{margin:2.3mm 0 0;font-size:8.2pt;line-height:1.55;color:#273244}
.description{margin:2.4mm 0 0;font-size:7.6pt;line-height:1.55;color:#667085}
.assurance-row{display:flex;justify-content:space-between;align-items:stretch;gap:4mm;margin-top:6.5mm}
.assurance-box,.validity-box{border:1px solid #dbe1e9;border-radius:2mm;background:#fbfcfd;padding:3.2mm 3.5mm}
.assurance-box{flex:1;display:flex;align-items:center;gap:2.7mm}
.assurance-icon{width:7mm;height:7mm;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#172033;color:#fff;font-size:9pt;font-weight:800;flex:0 0 auto}
.assurance-title{font-size:6.8pt;font-weight:800;color:#273244}.assurance-text{margin-top:.8mm;font-size:6.2pt;color:#7b8491}
.validity-box{min-width:56mm}.validity-label{font-size:5.8pt;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#8a94a3}.validity-value{margin-top:1.3mm;font-size:7.2pt;font-weight:800;color:#273244}.validity-value span{padding:0 1mm;color:#a0a8b4}
.footer-area{position:absolute;left:20mm;right:20mm;bottom:12mm;height:28mm;padding-top:4mm;display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:12mm}
.signatory{text-align:center;min-width:48mm}.signature-space{height:5mm}.signature-line{width:48mm;margin:0 auto;border-top:1px solid #4d596b}.signature-caption{margin-top:1mm;font-size:5.7pt;letter-spacing:.5px;text-transform:uppercase;color:#8a94a3}.signature-name{margin-top:1.4mm;font-size:6.8pt;font-weight:800;color:#273244}.signature-role{margin-top:.6mm;font-size:6.1pt;color:#667085}
.qr-area{display:flex;align-items:end;gap:3mm;justify-self:start}.qr{width:22mm;height:22mm;display:block;object-fit:contain}.qr-copy{padding-bottom:.7mm}.qr-title{font-size:5.8pt;letter-spacing:.8px;font-weight:800;color:#667085}.qr-ref{margin-top:1.2mm;font-size:6.6pt;font-weight:800;color:#273244}
`;

  return renderPdfDocument({
    title: data.certificateId,
    pageMargin: "0",
    styles,
    body,
  });
}
