import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  type LanguageCode
} from "@/i18n";

import { translate } from "@/i18n/translator";

import type { LanguageContextValue } from "@/types/language";


export const LanguageContext = createContext<
  LanguageContextValue | undefined
>(undefined);


function readStoredLanguage(): LanguageCode {

  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);

  if (stored && stored in LANGUAGES) {
    return stored as LanguageCode;
  }

  return DEFAULT_LANGUAGE;

}


export function LanguageProvider({
  children
}: PropsWithChildren): JSX.Element {

  const [language, setLanguageState] = useState<LanguageCode>(
    readStoredLanguage
  );


  const direction = LANGUAGES[language].direction;


  useEffect(() => {

    document.documentElement.setAttribute("lang", language);
    document.documentElement.setAttribute("dir", direction);

    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);

  }, [language, direction]);


  const setLanguage = useCallback((value: LanguageCode) => {
    setLanguageState(value);
  }, []);


  const t = useCallback(
    (key: string) => translate(language, key),
    [language]
  );


  const value = useMemo(
    () => ({
      language,
      direction,
      setLanguage,
      t
    }),
    [language, direction, setLanguage, t]
  );


  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );

}
