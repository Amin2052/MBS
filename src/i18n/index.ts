import en, { type TranslationDictionary } from "./en";
import bn from "./bn";
import ar from "./ar";

export type LanguageCode = "en" | "bn" | "ar";

export type { TranslationDictionary };

export const LANGUAGES: Record<
  LanguageCode,
  {
    code: LanguageCode;
    label: string;
    nativeLabel: string;
    flag: string;
    direction: "ltr" | "rtl";
    dictionary: TranslationDictionary;
  }
> = {

  en: {
    code: "en",
    label: "English",
    nativeLabel: "English",
    flag: "🇺🇸",
    direction: "ltr",
    dictionary: en
  },

  bn: {
    code: "bn",
    label: "Bangla",
    nativeLabel: "বাংলা",
    flag: "🇧🇩",
    direction: "ltr",
    dictionary: bn
  },

  ar: {
    code: "ar",
    label: "Arabic",
    nativeLabel: "العربية",
    flag: "🇸🇦",
    direction: "rtl",
    dictionary: ar
  }

};

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export const LANGUAGE_STORAGE_KEY = "mooral.language";
