import { createElement } from "react";
import { createRoot } from "react-dom/client";

import PrintPreviewModal from "@/components/print-preview/print-preview-modal";

/**
 * Print settings forwarded to Electron's native print pipeline.
 */
export interface TriggerPrintSettings {
  deviceName?: string;
  landscape?: boolean;
  copies?: number;
  color?: boolean;
  collate?: boolean;
  duplexMode?: "simplex" | "longEdge" | "shortEdge";
  printBackground?: boolean;
  pageSize?: "A4" | "A3" | "A5" | "Legal" | "Letter";
  scaleFactor?: number;
  pages?: "all" | "current" | "custom";
  pageRangeText?: string;
  currentPage?: number;
}

export async function triggerPrintWindow(
  settings?: TriggerPrintSettings
): Promise<void> {

  const printPreviewApi = (window as any).mooral?.printPreview;

  if (!printPreviewApi?.print) {
    throw new Error("The print service is unavailable. Please restart MBS and try again.");
  }

  const result = await printPreviewApi.print(settings);

  if (!result?.success) {
    throw new Error(result?.error || "The print dialog could not be opened. Please try again.");
  }

}


/**
 * MBS custom print preview. The user-visible preview is rendered by
 * PrintPreviewModal. The actual print target is created by the main process
 * only when Print is confirmed, kept hidden, and printed through
 * webContents.print(). This prevents a second visible preview window and
 * avoids renderer-side window.open/window.print races.
 */
/**
 * Locale-independent, filename-safe date (YYYY-MM-DD). Deliberately NOT
 * routed through the app's formatDateShort()/Date Format preference:
 * that can render as "MM/DD/YYYY" (MDY mode), and "/" is illegal in
 * Windows filenames. This is only ever used to build the print job's
 * document label, never shown as a user-facing date anywhere else.
 */
function formatFilenameDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Builds a consistent "<type> <id> - <date>" document label for every
 * print flow (Invoice/Certificate/Report/Credentials). This string is
 * used both as the preview modal's subheading AND, via
 * ensureHtmlHasTitle() in the main process, as the printed document's
 * <title> -- which Windows' "Microsoft Print to PDF" virtual printer
 * (and similar "print to file" drivers) uses as the suggested save
 * filename. So building the label this way is what makes exported/
 * printed file names auto-generate by document type + date, without
 * each page having to duplicate the same date-suffix logic.
 */
export function buildPrintDocumentLabel(type: string, id?: string | null): string {
  const idPart = id && String(id).trim() ? ` ${String(id).trim()}` : "";
  return `${type}${idPart} - ${formatFilenameDate()}`;
}

export type PrintPreviewResult = "printed" | "cancelled";

export interface ShowPrintPreviewOptions {
  html: string;
  documentLabel?: string;
}

export function showPrintPreview(
  options: ShowPrintPreviewOptions
): Promise<PrintPreviewResult> {

  const { html, documentLabel = "" } = options;

  const container = document.createElement("div");
  container.setAttribute("data-mbs-print-preview-root", "");
  document.body.appendChild(container);

  let unmounted = false;
  let root: ReturnType<typeof createRoot> | null = null;

  return new Promise<PrintPreviewResult>((resolveOuter) => {

    const cleanup = (result: PrintPreviewResult) => {
      if (unmounted) return;
      unmounted = true;

      setTimeout(() => {
        root?.unmount();
        container.remove();
      }, 0);

      resolveOuter(result);
    };

    const handleClose = () => cleanup("cancelled");

    const handlePrint = async (settings?: TriggerPrintSettings) => {
      const api = (window as any).mooral?.printPreview;
      if (!api?.create) {
        throw new Error("The print service is unavailable. Please restart MBS and try again.");
      }

      // Create a fresh hidden target for every print attempt. The main
      // process destroys the target when the native print dialog closes,
      // including cancellation/failure. Reusing a stale readiness flag
      // could therefore make a retry hit "Print target window is not
      // available" after a cancelled or failed print.
      const created = await api.create(html, documentLabel);
      if (!created?.success) {
        throw new Error(created?.error || "The print target window is not available. Please try again.");
      }

      await triggerPrintWindow(settings);
      cleanup("printed");
    };

    root = createRoot(container);
    root.render(
      createElement(PrintPreviewModal, {
        html,
        documentLabel,
        onPrint: handlePrint,
        onClose: handleClose
      })
    );

  });

}
