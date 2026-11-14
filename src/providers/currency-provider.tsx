import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

import {
  CURRENCY_STORAGE_KEY,
  DEFAULT_CURRENCY
} from "@/constants/currency";

import type { CurrencyCode } from "@/types/currency";

import { formatCurrency, type FormatCurrencyOptions } from "@/utils/currency";


export interface CurrencyContextValue {
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  format: (value: number | string, options?: FormatCurrencyOptions) => string;
}


export const CurrencyContext = createContext<
  CurrencyContextValue | undefined
>(undefined);


function readStoredCurrency(): CurrencyCode {

  const stored = localStorage.getItem(CURRENCY_STORAGE_KEY);

  if (
    stored === "BDT" ||
    stored === "USD" ||
    stored === "EUR" ||
    stored === "SAR"
  ) {
    return stored;
  }

  return DEFAULT_CURRENCY;

}


export function CurrencyProvider({
  children
}: PropsWithChildren): JSX.Element {

  const [currency, setCurrencyState] = useState<CurrencyCode>(
    readStoredCurrency
  );

  useEffect(() => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  }, [currency]);

  const setCurrency = useCallback((value: CurrencyCode) => {
    setCurrencyState(value);
  }, []);

  const format = useCallback(
    (value: number | string, options?: FormatCurrencyOptions) =>
        formatCurrency(Number(value) || 0, currency, options),
    [currency]
);

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      format
    }),
    [currency, setCurrency, format]
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );

}
