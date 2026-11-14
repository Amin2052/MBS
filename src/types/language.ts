import type { LanguageCode } from "@/i18n";

export interface LanguageContextValue {
  language: LanguageCode;
  direction: "ltr" | "rtl";
  setLanguage: (language: LanguageCode) => void;
  t: (key: string) => string;
}
