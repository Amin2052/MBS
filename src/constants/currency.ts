import type { CurrencyCode, CurrencyDefinition } from "@/types/currency";

export const CURRENCIES: Record<CurrencyCode, CurrencyDefinition> = {

  BDT: {
    code: "BDT",
    symbol: "৳",
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
