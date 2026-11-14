/**
 * Mooral Business Suite
 * PDF Core Engine - HTML Shell & Utilities
 *
 * Framework-independent, visual-neutral helpers for assembling the
 * HTML string that gets handed to the existing printToPDF pipeline
 * (BrowserWindow.loadFile -> printToPDF -> fs.writeFileSync).
 *
 * IMPORTANT: this file intentionally carries NO shared visual design
 * (no brand colors, no shared typography, no shared spacing/theme
 * object). Per-document visual design was removed - each template
 * under src/pdf/templates/ is responsible for its own future look
 * and feel and must not depend on a centralized theme here. What
 * remains below is purely structural: HTML escaping, print-safety
 * CSS (page-break control, box-sizing), and the @page size/margin
 * for the printToPDF call. Nothing here talks to Electron, IPC, or
 * the database.
 */


/**
 * Escapes a value for safe interpolation into PDF HTML.
 */
export function escapeHtml(
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


export interface PdfDocumentOptions {
  /** Document <title>, shown in some PDF viewers/print dialogs. */
  title: string;
  /** "rtl" for Arabic, "ltr" otherwise. Defaults to "ltr". */
  dir?: "ltr" | "rtl";
  /** CSS @page size, e.g. "A4" or "A4 landscape". Defaults to "A4". */
  pageSize?: string;
  /** CSS @page margin shorthand, e.g. "15mm" or "15mm 18mm". Defaults to "15mm". */
  pageMargin?: string;
  /** Full CSS for the document - each template owns its own styling entirely. */
  styles?: string;
  /** Inner body HTML for the document. */
  body: string;
}


/**
 * Print-safety rules only - no color, no font, no spacing scale.
 * Purely structural so it can never impose a visual identity on a
 * document: box-sizing reset, image/table print behavior, and
 * page-break control. Everything else (typography, color, layout)
 * belongs entirely to the calling template's own `styles`.
 */
const STRUCTURAL_RESET = `
* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
}

img {
  max-width: 100%;
}

table {
  border-collapse: collapse;
}

/* Multi-page PDF safety: table headers repeat on continuation pages and
   rows never split through their own content. This is structural only;
   each PDF template still owns its visual header and spacing. */
thead {
  display: table-header-group;
}

tfoot {
  display: table-footer-group;
}

tbody tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

.pdf-avoid-break {
  break-inside: avoid;
  page-break-inside: avoid;
}

.pdf-page-break-before {
  break-before: page;
  page-break-before: always;
}
`;


/**
 * Assembles a complete standalone HTML document (<html>...</html>)
 * ready to be written to a temp file and loaded by the off-screen
 * BrowserWindow, exactly like the existing invoice/certificate/
 * report/credential builders do. Carries no visual design of its
 * own - `styles` and `body` are entirely up to the caller.
 */
export function renderPdfDocument(
  options: PdfDocumentOptions
): string {
  const dir = options.dir ?? "ltr";
  const pageSize = options.pageSize ?? "A4";
  const pageMargin = options.pageMargin ?? "15mm";

  return `
<!doctype html>
<html dir="${dir}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(options.title)}</title>
<style>
@page {
  size: ${pageSize};
  margin: ${pageMargin};
}
${STRUCTURAL_RESET}
${options.styles ?? ""}
</style>
</head>
<body>
${options.body}
</body>
</html>
`;
}


/**
 * Joins an array of row-html strings produced by a `.map()` call,
 * skipping falsy entries. Small convenience used by templates when
 * composing table rows or optional info lines.
 */
export function joinHtml(
  parts: Array<string | null | undefined | false>
): string {
  return parts.filter(Boolean).join("");
}
