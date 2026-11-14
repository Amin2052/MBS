export type CurrencyCode = "BDT" | "USD" | "EUR" | "SAR";

export interface CurrencyDefinition {
  code: CurrencyCode;
  symbol: string;
  label: string;
  locale: string;
}
