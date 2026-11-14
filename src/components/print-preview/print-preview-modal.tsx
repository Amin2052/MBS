import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { Printer, Plus } from "lucide-react";

import { translate } from "@/i18n/translator";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  type LanguageCode
} from "@/i18n";

import "./print-preview.css";

/**
 * MBS's own print-preview screen, shown BEFORE the native OS print
 * dialog. This exists because Windows 11 22H2+ shows "This app doesn't
 * support print preview" in the native dialog's right-hand pane for
 * every classic Win32-style app (Electron included) that uses the
 * standard interactive print dialog -- a documented Windows-level
 * limitation, not something fixable from application code (see
 * src/utils/print-window.ts for the investigation notes). Rather than
 * keep fighting that, MBS now shows its own accurate preview of the
 * exact same HTML that will be sent to the printer, so the user always
 * sees the real document before the OS dialog (with or without its own
 * preview pane) ever appears.
 *
 * This component is deliberately NOT wired into React Context (no
 * useLanguage()/useTheme() hooks) because it is mounted imperatively
 * via a standalone React root (see showPrintPreview() in
 * print-window.ts), outside the app's normal provider tree. Dark/Light
 * theme still applies automatically since that's plain CSS custom
 * properties on <html data-theme>; language/RTL are read directly from
 * the same global <html lang>/<html dir> attributes and localStorage
 * key the LanguageProvider itself writes to, using the underlying pure
 * translate() function instead of the t() hook.
 */

const A4_PAGE_WIDTH_PX = 794; // 210mm @ 96dpi
const A4_PAGE_HEIGHT_PX = 1123; // 297mm @ 96dpi

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

function readCurrentLanguage(): LanguageCode {

  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);

  if (stored && stored in LANGUAGES) {
    return stored as LanguageCode;
  }

  return DEFAULT_LANGUAGE;

}

function readCurrentDirection(): "ltr" | "rtl" {

  const dir = document.documentElement.getAttribute("dir");

  return dir === "rtl" ? "rtl" : "ltr";

}

export type PrintPreviewStatus = "loading" | "ready" | "printing" | "error";

export type PrintPagesMode = "all" | "current" | "custom";
export type PrintColorMode = "color" | "bw";
export type PrintScaleMode = "fit" | "actual" | "custom";
export type PrintPaperSize = "A4" | "A3" | "A5" | "Legal" | "Letter";
export type PrintDuplexMode = "simplex" | "longEdge" | "shortEdge";

export interface ResolvedPrintSettings {
  deviceName?: string;
  landscape: boolean;
  copies: number;
  color: boolean;
  collate: boolean;
  duplexMode: PrintDuplexMode;
  printBackground: boolean;
  pageSize: PrintPaperSize;
  scaleFactor?: number;
  pages: PrintPagesMode;
  pageRangeText?: string;
  currentPage: number;
}

interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export interface PrintPreviewModalProps {
  html: string;
  documentLabel: string;
  onPrint: (settings: ResolvedPrintSettings) => Promise<void> | void;
  onClose: () => void;
}

export default function PrintPreviewModal({
  html,
  documentLabel,
  onPrint,
  onClose
}: PrintPreviewModalProps): JSX.Element {

  const language = useMemo(readCurrentLanguage, []);
  const direction = useMemo(readCurrentDirection, []);
  const t = useCallback(
    (key: string) => translate(language, key),
    [language]
  );

  const [status, setStatus] = useState<PrintPreviewStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Print Settings panel state. Every one of these maps to a real
  // webContents.print() option forwarded through triggerPrintWindow ->
  // the "print-preview:print" IPC handler in electron/main/main.ts --
  // see ResolvedPrintSettings above and that handler for the mapping.
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [landscape, setLandscape] = useState(false);
  const [pagesMode, setPagesMode] = useState<PrintPagesMode>("all");
  const [customRangeText, setCustomRangeText] = useState("");
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<PrintColorMode>("color");
  const [paperSize, setPaperSize] = useState<PrintPaperSize>("A4");
  const [scaleMode, setScaleMode] = useState<PrintScaleMode>("fit");
  const [customScale, setCustomScale] = useState(100);
  const [printBackground, setPrintBackground] = useState(true);
  const [collate, setCollate] = useState(true);
  const [duplexMode, setDuplexMode] = useState<PrintDuplexMode>("simplex");
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  const [printerNote, setPrinterNote] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Load the real printer list once, from Electron's own
  // getPrintersAsync() (see print-preview:getPrinters in main.ts) --
  // never a hand-maintained/fake list. Defaults to whichever printer
  // Windows itself reports as default; falls back to "system default"
  // (deviceName omitted) if the call returns nothing.
  useEffect(() => {

    let cancelled = false;

    const printPreviewApi = (window as any).mooral?.printPreview;

    if (!printPreviewApi?.getPrinters) {
      return;
    }

    printPreviewApi.getPrinters()
      .then((list: PrinterInfo[]) => {

        if (cancelled) {
          return;
        }

        setPrinters(list ?? []);

        const defaultPrinter = (list ?? []).find(p => p.isDefault);

        if (defaultPrinter) {
          setSelectedPrinter(defaultPrinter.name);
        } else if (list && list.length > 0) {
          setSelectedPrinter(list[0].name);
        }

      })
      .catch(() => {
        // Leave printers empty -- the UI falls back to "system
        // default" rather than showing an error for this.
      });

    return () => {
      cancelled = true;
    };

  }, []);

  // Fit-to-width on first mount and on window resize, so the document
  // always opens at a sensible, readable zoom instead of an
  // unnecessarily huge or tiny default.
  useEffect(() => {

    const fitToWidth = () => {

      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      const availableWidth = viewport.clientWidth - 48;
      const fitZoom = availableWidth / A4_PAGE_WIDTH_PX;

      setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitZoom)));

    };

    fitToWidth();

    window.addEventListener("resize", fitToWidth);

    return () => window.removeEventListener("resize", fitToWidth);

  }, [isFullscreen]);

  const handleIframeLoad = useCallback(() => {

    const frame = iframeRef.current;
    const frameDocument = frame?.contentDocument;

    if (!frame || !frameDocument) {
      setStatus("error");
      setErrorMessage(t("printPreview.errorRender"));
      return;
    }

    const finalizeReady = () => {

      const contentHeight = frameDocument.documentElement?.scrollHeight
        ?? frameDocument.body?.scrollHeight
        ?? A4_PAGE_HEIGHT_PX;

      const pages = Math.max(
        1,
        Math.round(contentHeight / A4_PAGE_HEIGHT_PX)
      );

      setPageCount(pages);
      setCurrentPage(1);
      setStatus("ready");

    };

    // Make sure every image has actually decoded before treating the
    // preview as ready,
    // so the user isn't shown a half-rendered document (missing logo,
    // missing QR/signature image, etc).
    const deadline = Date.now() + 2000;

    const pollImages = () => {

      const images = Array.from(frameDocument.images);
      const imagesReady = images.every(
        (img) => img.complete && img.naturalWidth > 0
      );

      if (imagesReady || Date.now() > deadline) {
        finalizeReady();
        return;
      }

      setTimeout(pollImages, 50);

    };

    pollImages();

  }, [t]);

  const handleIframeError = useCallback(() => {
    setStatus("error");
    setErrorMessage(t("printPreview.errorRender"));
  }, [t]);

  const handlePrintClick = useCallback(async () => {

    if (status === "printing") {
      return;
    }

    setStatus("printing");
    setErrorMessage(null);

    const settings: ResolvedPrintSettings = {
      deviceName: selectedPrinter || undefined,
      landscape,
      copies: Math.max(1, Math.round(copies) || 1),
      color: colorMode === "color",
      collate,
      duplexMode,
      printBackground,
      pageSize: paperSize,
      scaleFactor:
        scaleMode === "actual"
          ? 100
          : scaleMode === "custom"
            ? Math.max(10, Math.min(200, Math.round(customScale) || 100))
            : undefined,
      pages: pagesMode,
      pageRangeText: pagesMode === "custom" ? customRangeText : undefined,
      currentPage
    };

    try {
      await onPrint(settings);
      onClose();
    } catch (error) {
      setStatus("ready");
      setErrorMessage(
        error instanceof Error ? error.message : t("printPreview.errorPrint")
      );
    }

  }, [
    status,
    onPrint,
    onClose,
    t,
    selectedPrinter,
    landscape,
    copies,
    colorMode,
    collate,
    duplexMode,
    printBackground,
    paperSize,
    scaleMode,
    customScale,
    pagesMode,
    customRangeText,
    currentPage
  ]);

  const handleManagePrinters = useCallback(async () => {

    const printPreviewApi = (window as any).mooral?.printPreview;

    if (!printPreviewApi?.openPrinterSettings) {
      setPrinterNote(t("printPreview.managePrintersUnavailable"));
      return;
    }

    try {
      const result = await printPreviewApi.openPrinterSettings();
      if (!result?.success) {
        setPrinterNote(t("printPreview.managePrintersUnavailable"));
      }
    } catch {
      setPrinterNote(t("printPreview.managePrintersUnavailable"));
    }

  }, [t]);

  const handleAddPrinter = useCallback(async () => {

    const printPreviewApi = (window as any).mooral?.printPreview;

    if (!printPreviewApi?.addPrinter) {
      setPrinterNote(t("printPreview.managePrintersUnavailable"));
      return;
    }

    try {
      const result = await printPreviewApi.addPrinter();
      if (!result?.success) {
        setPrinterNote(t("printPreview.managePrintersUnavailable"));
      } else {
        setPrinterNote(null);
      }
    } catch {
      setPrinterNote(t("printPreview.managePrintersUnavailable"));
    }

  }, [t]);

  const handleZoomIn = useCallback(() => {
    setZoom((current) => Math.min(ZOOM_MAX, Number((current + ZOOM_STEP).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((current) => Math.max(ZOOM_MIN, Number((current - ZOOM_STEP).toFixed(2))));
  }, []);

  const handleFitToPage = useCallback(() => {

    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const availableWidth = viewport.clientWidth - 48;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, availableWidth / A4_PAGE_WIDTH_PX)));

  }, []);

  const scrollToPage = useCallback((pageNumber: number) => {

    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const clamped = Math.min(pageCount, Math.max(1, pageNumber));

    setCurrentPage(clamped);

    viewport.scrollTo({
      top: (clamped - 1) * A4_PAGE_HEIGHT_PX * zoom,
      behavior: "smooth"
    });

  }, [pageCount, zoom]);

  return (
    <div
      className="print-preview-overlay"
      dir={direction}
      role="dialog"
      aria-modal="true"
      aria-label={t("printPreview.title")}
    >
      <div className={`print-preview-panel${isFullscreen ? " print-preview-panel-fullscreen" : ""}`}>

        <div className="print-preview-title-row">
          <span className="print-preview-toolbar-heading">
            {t("printPreview.title")}
          </span>
          {documentLabel ? (
            <span className="print-preview-toolbar-subheading">
              {documentLabel}
            </span>
          ) : null}
        </div>

        <div className="print-preview-toolbar">

          <div className="print-preview-page-nav">
            <button
              type="button"
              className="print-preview-icon-btn"
              onClick={() => scrollToPage(currentPage - 1)}
              disabled={pageCount <= 1 || currentPage <= 1}
              aria-label={t("printPreview.previousPage")}
            >
              ‹
            </button>
            <span className="print-preview-page-indicator">
              {t("printPreview.pageOf")
                .replace("{current}", String(currentPage))
                .replace("{total}", String(pageCount))}
            </span>
            <button
              type="button"
              className="print-preview-icon-btn"
              onClick={() => scrollToPage(currentPage + 1)}
              disabled={pageCount <= 1 || currentPage >= pageCount}
              aria-label={t("printPreview.nextPage")}
            >
              ›
            </button>
          </div>

          <div className="print-preview-toolbar-controls">

            <div className="print-preview-zoom-controls">
              <button
                type="button"
                className="print-preview-icon-btn"
                onClick={handleZoomOut}
                disabled={zoom <= ZOOM_MIN}
                aria-label={t("printPreview.zoomOut")}
              >
                −
              </button>
              <span className="print-preview-zoom-value">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="print-preview-icon-btn"
                onClick={handleZoomIn}
                disabled={zoom >= ZOOM_MAX}
                aria-label={t("printPreview.zoomIn")}
              >
                +
              </button>
            </div>

            <button
              type="button"
              className="print-preview-btn print-preview-btn-secondary"
              onClick={handleFitToPage}
            >
              {t("printPreview.fitWidth")}
            </button>

            <button
              type="button"
              className="print-preview-icon-btn print-preview-expand-btn"
              onClick={() => setIsFullscreen((v) => !v)}
              aria-label={t(isFullscreen ? "printPreview.collapse" : "printPreview.expand")}
              title={t(isFullscreen ? "printPreview.collapse" : "printPreview.expand")}
            >
              {isFullscreen ? "⤡" : "⤢"}
            </button>

            <button
              type="button"
              className="print-preview-btn print-preview-btn-secondary"
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>

            <button
              type="button"
              className="print-preview-btn print-preview-btn-primary"
              onClick={handlePrintClick}
              disabled={status === "loading" || status === "printing" || status === "error"}
            >
              {status === "printing" ? t("printPreview.printing") : t("common.print")}
            </button>

          </div>

        </div>

        <div className="print-preview-body">

          <div className="print-preview-settings-panel">

            <div className="print-preview-settings-heading">
              {t("printPreview.settingsTitle")}
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.printer")}
              </label>
              <select
                className="print-preview-select"
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
              >
                {printers.length === 0 ? (
                  <option value="">{t("printPreview.systemDefaultPrinter")}</option>
                ) : (
                  printers.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName}
                    </option>
                  ))
                )}
              </select>
              <div className="print-preview-printer-actions">
                <button
                  type="button"
                  className="print-preview-ghost-btn"
                  onClick={handleManagePrinters}
                >
                  <Printer size={14} />
                  <span>{t("printPreview.managePrinters")}</span>
                </button>
                <button
                  type="button"
                  className="print-preview-ghost-btn"
                  onClick={handleAddPrinter}
                >
                  <Plus size={14} />
                  <span>{t("printPreview.addPrinter")}</span>
                </button>
              </div>
              {printerNote ? (
                <div className="print-preview-field-note">{printerNote}</div>
              ) : null}
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.orientation")}
              </label>
              <div className="print-preview-toggle-row">
                <button
                  type="button"
                  className={`print-preview-toggle-btn${!landscape ? " active" : ""}`}
                  onClick={() => setLandscape(false)}
                >
                  {t("printPreview.portrait")}
                </button>
                <button
                  type="button"
                  className={`print-preview-toggle-btn${landscape ? " active" : ""}`}
                  onClick={() => setLandscape(true)}
                >
                  {t("printPreview.landscape")}
                </button>
              </div>
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.pages")}
              </label>
              <label className="print-preview-radio-row">
                <input
                  type="radio"
                  name="pp-pages"
                  checked={pagesMode === "all"}
                  onChange={() => setPagesMode("all")}
                />
                {t("printPreview.allPages")}
              </label>
              <label className="print-preview-radio-row">
                <input
                  type="radio"
                  name="pp-pages"
                  checked={pagesMode === "current"}
                  onChange={() => setPagesMode("current")}
                />
                {t("printPreview.currentPage")}
              </label>
              <label className="print-preview-radio-row">
                <input
                  type="radio"
                  name="pp-pages"
                  checked={pagesMode === "custom"}
                  onChange={() => setPagesMode("custom")}
                />
                {t("printPreview.customRange")}
              </label>
              <input
                type="text"
                className="print-preview-text-input print-preview-range-input"
                placeholder={t("printPreview.customRangePlaceholder")}
                value={customRangeText}
                disabled={pagesMode !== "custom"}
                onChange={(e) => setCustomRangeText(e.target.value)}
              />
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.copies")}
              </label>
              <div className="print-preview-copies-row">
                <button
                  type="button"
                  className="print-preview-icon-btn print-preview-stepper-btn"
                  onClick={() => setCopies((c) => Math.max(1, c - 1))}
                >
                  −
                </button>
                <input
                  type="number"
                  className="print-preview-text-input print-preview-copies-input"
                  min={1}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
                <button
                  type="button"
                  className="print-preview-icon-btn print-preview-stepper-btn"
                  onClick={() => setCopies((c) => c + 1)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.colorMode")}
              </label>
              <select
                className="print-preview-select"
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as PrintColorMode)}
              >
                <option value="color">{t("printPreview.color")}</option>
                <option value="bw">{t("printPreview.blackAndWhite")}</option>
              </select>
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.paperSize")}
              </label>
              <select
                className="print-preview-select"
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as PrintPaperSize)}
              >
                <option value="A4">A4 (210 x 297 mm)</option>
                <option value="A3">A3 (297 x 420 mm)</option>
                <option value="A5">A5 (148 x 210 mm)</option>
                <option value="Letter">Letter (8.5 x 11 in)</option>
                <option value="Legal">Legal (8.5 x 14 in)</option>
              </select>
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.scale")}
              </label>
              <label className="print-preview-radio-row">
                <input
                  type="radio"
                  name="pp-scale"
                  checked={scaleMode === "fit"}
                  onChange={() => setScaleMode("fit")}
                />
                {t("printPreview.fitToPage")}
              </label>
              <label className="print-preview-radio-row">
                <input
                  type="radio"
                  name="pp-scale"
                  checked={scaleMode === "actual"}
                  onChange={() => setScaleMode("actual")}
                />
                {t("printPreview.actualSize")}
              </label>
              <label className="print-preview-radio-row">
                <input
                  type="radio"
                  name="pp-scale"
                  checked={scaleMode === "custom"}
                  onChange={() => setScaleMode("custom")}
                />
                {t("printPreview.customScale")}
              </label>
              <input
                type="number"
                className="print-preview-text-input print-preview-range-input"
                min={10}
                max={200}
                disabled={scaleMode !== "custom"}
                value={customScale}
                onChange={(e) => setCustomScale(parseInt(e.target.value, 10) || 100)}
              />
            </div>

            <div className="print-preview-field">
              <label className="print-preview-field-label">
                {t("printPreview.options")}
              </label>
              <label className="print-preview-checkbox-row">
                <input
                  type="checkbox"
                  checked={printBackground}
                  onChange={(e) => setPrintBackground(e.target.checked)}
                />
                {t("printPreview.printBackground")}
              </label>
              <label
                className="print-preview-checkbox-row print-preview-checkbox-disabled"
                title={t("printPreview.headersFootersUnavailable")}
              >
                <input type="checkbox" disabled />
                {t("printPreview.headersFooters")}
              </label>
              <label
                className="print-preview-checkbox-row print-preview-checkbox-disabled"
                title={t("printPreview.printSelectionUnavailable")}
              >
                <input type="checkbox" disabled />
                {t("printPreview.printSelectionOnly")}
              </label>
            </div>

            <button
              type="button"
              className="print-preview-more-settings-toggle"
              onClick={() => setMoreSettingsOpen((v) => !v)}
            >
              {t(moreSettingsOpen ? "printPreview.fewerSettings" : "printPreview.moreSettings")}
              <span className={`print-preview-chevron${moreSettingsOpen ? " open" : ""}`}>⌄</span>
            </button>

            {moreSettingsOpen ? (
              <div className="print-preview-field">
                <label className="print-preview-checkbox-row">
                  <input
                    type="checkbox"
                    checked={collate}
                    onChange={(e) => setCollate(e.target.checked)}
                  />
                  {t("printPreview.collate")}
                </label>
                <label className="print-preview-field-label print-preview-field-label-spaced">
                  {t("printPreview.twoSided")}
                </label>
                <select
                  className="print-preview-select"
                  value={duplexMode}
                  onChange={(e) => setDuplexMode(e.target.value as PrintDuplexMode)}
                >
                  <option value="simplex">{t("printPreview.twoSidedOff")}</option>
                  <option value="longEdge">{t("printPreview.twoSidedLongEdge")}</option>
                  <option value="shortEdge">{t("printPreview.twoSidedShortEdge")}</option>
                </select>
              </div>
            ) : null}

          </div>

          <div className="print-preview-viewport" ref={viewportRef}>

            {status === "loading" ? (
              <div className="print-preview-state print-preview-state-loading">
                <div className="print-preview-spinner" />
                <span>{t("printPreview.loading")}</span>
              </div>
            ) : null}

            {status === "error" ? (
              <div className="print-preview-state print-preview-state-error">
                <span className="print-preview-error-icon">!</span>
                <span>{errorMessage ?? t("printPreview.errorRender")}</span>
                <button
                  type="button"
                  className="print-preview-btn print-preview-btn-secondary"
                  onClick={onClose}
                >
                  {t("common.close")}
                </button>
              </div>
            ) : null}

            <div
              className="print-preview-page-stack"
              style={{
                visibility: status === "loading" || status === "error" ? "hidden" : "visible"
              }}
            >
              <div
                className="print-preview-page"
                style={{
                  width: A4_PAGE_WIDTH_PX,
                  minHeight: A4_PAGE_HEIGHT_PX * pageCount,
                  transform: `scale(${zoom})`
                }}
              >
                <iframe
                  ref={iframeRef}
                  title={documentLabel || t("printPreview.title")}
                  className="print-preview-iframe"
                  srcDoc={html}
                  onLoad={handleIframeLoad}
                  onError={handleIframeError}
                />
              </div>
            </div>

          </div>

        </div>

        <div className="print-preview-status-bar">
          <span className="print-preview-status-icon">ⓘ</span>
          <span>
            {status === "loading"
              ? t("printPreview.loading")
              : status === "error"
                ? (errorMessage ?? t("printPreview.errorRender"))
                : status === "printing"
                  ? t("printPreview.printing")
                  : t("printPreview.documentLoaded")}
          </span>
        </div>

        {errorMessage && status === "ready" ? (
          <div className="print-preview-inline-error">
            {errorMessage}
          </div>
        ) : null}

      </div>
    </div>
  );

}
