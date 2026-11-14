/**
 * Mooral Business Suite
 * Master Number Formatter
 *
 * Purpose:
 * - Only changes display format
 * - Never changes actual calculation value
 * - No rounding
 *
 * Examples (en-US number format):
 * 999      -> 999
 * 1000     -> 1K
 * 1200     -> 1.2K
 * 9995     -> 9.995K
 * 100000   -> 100K
 * 1250000  -> 1.25M
 *
 * The K/M abbreviation and grouping/decimal separator style (e.g.
 * 1,234.56 vs 1.234,56 vs the Indian 1,23,456) both come from the
 * Settings > Localization > Number Format preference -- see
 * setNumberFormatPreference(). Module-level like date-format.ts's
 * currentFormat, for the same reason: formatNumber() is called from
 * many plain (non-component) contexts across the app.
 */

const NUMBER_FORMAT_STORAGE_KEY = "mooral.numberFormat";

export type NumberFormatCode = "en-US" | "en-IN" | "de-DE";

let currentLocale: NumberFormatCode = readStoredNumberFormat();

function readStoredNumberFormat(): NumberFormatCode {

  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(NUMBER_FORMAT_STORAGE_KEY) : null;

  if (stored === "en-US" || stored === "en-IN" || stored === "de-DE") {
    return stored;
  }

  return "en-US";

}

export function setNumberFormatPreference(format: NumberFormatCode): void {

  currentLocale = format;

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(NUMBER_FORMAT_STORAGE_KEY, format);
  }

}

export function formatNumber(value: number | string): string {
  const num = Number(value);

  if (Number.isNaN(num)) return "0";

  const format = (n: number) =>
    new Intl.NumberFormat(currentLocale, { maximumFractionDigits: 3 }).format(
      Number(n.toFixed(3))
    );

  if (Math.abs(num) >= 1_000_000) {
    return `${format(num / 1_000_000)}M`;
  }

  if (Math.abs(num) >= 1_000) {
    return `${format(num / 1_000)}K`;
  }

  return format(num);
}
