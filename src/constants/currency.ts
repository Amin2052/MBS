import type { CurrencyCode, CurrencyDefinition } from "@/types/currency";

export const CURRENCIES: Record<CurrencyCode, CurrencyDefinition> = {

  BDT: {
    code: "BDT",
    // The taka sign is intentionally not used anywhere in the product; the
    // ISO code is shown in its place so amounts stay unambiguous.
    symbol: "BDT",
    label: "Bangladeshi Taka",
    locale: "bn-BD"
  },

  USD: {
    code: "USD",
    symbol: "$",
    label: "US Dollar",
    locale: "en-US"
  },

  EUR: {
    code: "EUR",
    symbol: "€",
    label: "Euro",
    locale: "en-IE"
  },

  SAR: {
    code: "SAR",
    symbol: "﷼",
    label: "Saudi Riyal",
    locale: "ar-SA"
  }

};

export const DEFAULT_CURRENCY: CurrencyCode = "BDT";

export const CURRENCY_STORAGE_KEY = "mooral.currency";
