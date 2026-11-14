import { CURRENCIES, DEFAULT_CURRENCY } from "@/constants/currency";

// Amounts are formatted as "<symbol> <western-digit-number>" (e.g. "৳ 1,234.50",
// "$ 1,234.50") rather than via Intl.NumberFormat's `style: "currency"`.
// That built-in style is inconsistent across our supported currencies when
// paired with a fixed "en-US" locale: BDT and SAR fall back to printing the
// ISO code ("BDT 1,234.50") instead of a symbol, while switching to each
// currency's own locale (bn-BD, ar-SA) would switch the digits themselves to
// non-Latin numerals, which is inconsistent with the Western-digit numbers
// used everywhere else in the app (see utils/format-number.ts). Using the
// explicit CURRENCIES symbol keeps the digits consistent while still
// reflecting the user's selected currency.
//
// Display mode: normal UI amount displays use compact K/M notation for
// large figures (e.g. "$ 1.5K", "$ 2.3M"), consistent with the rest of the
// app's number formatting. This is display-only -- it never touches the
// underlying stored/calculated value. Screens where the person needs to
// read or verify an exact amount (the Edit Invoice form, the Invoice
// PDF/print output) opt out via `{ compact: false }` to always show the
// full precise amount.
export interface FormatCurrencyOptions {
  compact?: boolean;
}

function formatCompactAmount(amount: number): string {
  const abs = Math.abs(amount);

  const round = (n: number) => Number(n.toFixed(2));

  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(round(amount / 1_000_000))}M`;
  }

  if (abs >= 1_000) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(round(amount / 1_000))}K`;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCurrency(
  value: number,
  currency = DEFAULT_CURRENCY,
  options?: FormatCurrencyOptions
): string {
  const amount = Number(value ?? 0);
  const compact = options?.compact ?? true;

  const symbol =
    CURRENCIES[currency]?.symbol ?? CURRENCIES[DEFAULT_CURRENCY].symbol;

  const formattedNumber = compact
    ? formatCompactAmount(amount)
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);

  return `${symbol} ${formattedNumber}`;
}
