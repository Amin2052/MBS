/**
 * Mooral Business Suite
 * Central PDF rendering engine.
 *
 * This file owns ONLY the rendering pipeline. Every PDF type keeps its own
 * HTML/CSS template in src/pdf/templates/. The engine never contains visual
 * design and therefore cannot make Report/Invoice/Certificate templates
 * look alike.
 */

import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface PdfRenderRequest {
  html: string;
  fileName: string;
  dialogTitle: string;
  pageSize?: "A4" | "A3" | "Letter" | "Legal";
  preferCssPageSize?: boolean;
  printBackground?: boolean;
  // Optional repeating footer, rendered by Chromium in its own
  // per-page layer via printToPDF's displayHeaderFooter/footerTemplate.
  // This is the only mechanism confirmed (by actually rendering
  // multi-page output and inspecting it) to repeat on every PDF page
  // without risking overlap with flowing content -- see the footer
  // investigation notes in invoices-page.tsx's buildInvoiceHtml().
  // `footerMarginMm` reserves that much blank space at the bottom of
  // every page for it; callers must size this to fit their footer.
  // The HTML passed in `html` must NOT declare its own conflicting
  // `@page { margin }` when footerTemplateHtml is set -- see the
  // margins comment further down for why.
  footerTemplateHtml?: string;
  footerMarginMm?: number;
}

export interface PdfRenderResult {
  success: boolean;
  filePath?: string;
  cancelled?: boolean;
  error?: string;
}

function createTempHtmlPath(prefix: string): string {
  return path.join(
    app.getPath("temp"),
    `mooral-pdf-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  );
}

async function waitForDocumentReady(printWindow: BrowserWindow): Promise<void> {
  await printWindow.webContents.executeJavaScript(`
    (async function () {
      const deadline = Date.now() + 5000;

      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (_) {}
      }

      while (Date.now() < deadline) {
        const images = Array.from(document.images);
        const imagesReady = images.every((img) =>
          img.complete && (img.naturalWidth > 0 || img.src === "")
        );

        if (imagesReady) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      return true;
    })();
  `);

  // Give Chromium one paint cycle after assets/fonts have settled. This is
  // important for inline QR/logo data URLs and SVG charts.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

export async function renderPdf(
  request: PdfRenderRequest
): Promise<PdfRenderResult> {
  const parentWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

  if (!parentWindow) {
    return { success: false, error: "Main application window is unavailable." };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
    title: request.dialogTitle,
    defaultPath: request.fileName,
    filters: [{ name: "PDF Files", extensions: ["pdf"] }]
  });

  if (canceled || !filePath) {
    return { success: false, cancelled: true };
  }

  let printWindow: BrowserWindow | null = null;
  let tempHtmlPath: string | null = null;

  try {
    tempHtmlPath = createTempHtmlPath(
      path.basename(request.fileName, path.extname(request.fileName))
        .replace(/[^a-z0-9_-]/gi, "-")
    );

    // UTF-8 temp files avoid data: URL size/decoding edge cases and make
    // relative/local assets behave predictably during Chromium rendering.
    fs.writeFileSync(tempHtmlPath, request.html, "utf8");

    printWindow = new BrowserWindow({
      show: false,
      // Explicit A4-at-96dpi viewport (794x1123 px). printToPDF's own
      // page dimensions come from preferCSSPageSize + the template's
      // `@page` rule below, but leaving this window at Electron's
      // default 800x600 meant any percentage/flex-based CSS in a
      // template was laid out against an arbitrary, non-A4-shaped
      // viewport before the print pass -- a plausible source of the
      // "compressed / stuck to one side" symptom on templates that
      // aren't 100% fixed-mm (e.g. flex rows sized in %). Giving the
      // offscreen window an A4-shaped viewport up front removes that
      // class of bug regardless of page orientation set by a given
      // template's own `@page` rule.
      width: 794,
      height: 1123,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    await printWindow.loadFile(tempHtmlPath);
    await waitForDocumentReady(printWindow);

    const hasFooter = Boolean(request.footerTemplateHtml);

    const pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: request.printBackground ?? true,
      preferCSSPageSize: request.preferCssPageSize ?? true,
      pageSize: request.pageSize ?? "A4",
      ...(hasFooter
        ? {
            displayHeaderFooter: true,
            headerTemplate: "<span></span>",
            footerTemplate: request.footerTemplateHtml,
            // IMPORTANT (confirmed by actually rendering multi-page
            // output and inspecting every page, not assumed): if the
            // HTML being printed declares its own `@page { margin: ... }`
            // rule, that CSS margin wins over these explicit margins
            // for pagination purposes -- the reserved footer space is
            // silently ignored and rows overlap the footer. Callers
            // that pass footerTemplateHtml MUST build their HTML
            // without a conflicting `@page` margin declaration (see
            // buildInvoiceHtml's `includeFooter` param in
            // invoices-page.tsx, which omits it for the export path).
            // Top/left/right stay at 0 here because the HTML's own
            // existing element padding already reproduces the prior
            // visual top/side margins unchanged; only bottom is
            // reserved -- sized to fit the caller's footer plus
            // clearance without wasting page space (an oversized
            // reservation can itself push a near-empty extra page onto
            // documents whose content would otherwise land right at a
            // page boundary -- also confirmed empirically).
            margins: {
              top: 0,
              left: 0,
              right: 0,
              bottom: (request.footerMarginMm ?? 12) / 25.4
            }
          }
        : {})
    });

    fs.writeFileSync(filePath, pdfBuffer);

    return { success: true, filePath };
  } catch (error) {
    console.error("PDF EXPORT FAILED", error);

    return {
      success: false,
      cancelled: false,
      error: error instanceof Error ? error.message : "Unknown PDF export error"
    };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.destroy();
    }

    if (tempHtmlPath) {
      try {
        fs.unlinkSync(tempHtmlPath);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
