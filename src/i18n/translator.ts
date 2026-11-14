import { LANGUAGES, type LanguageCode } from "./index";

/**
 * Resolves a dot-notation path (e.g. "invoices.status.Paid") against a
 * translation dictionary. Falls back to the English dictionary if a key
 * is missing in the active language, and finally to the raw key itself
 * so the UI never shows "undefined".
 */
export function translate(
  language: LanguageCode,
  key: string
): string {

  const activeDictionary = LANGUAGES[language]?.dictionary;
  const fallbackDictionary = LANGUAGES.en.dictionary;

  const fromActive = resolvePath(activeDictionary, key);

  if (typeof fromActive === "string") {
    return fromActive;
  }

  const fromFallback = resolvePath(fallbackDictionary, key);

  if (typeof fromFallback === "string") {
    return fromFallback;
  }

  return key;

}


function resolvePath(source: unknown, path: string): unknown {

  return path
    .split(".")
    .reduce<unknown>((current, segment) => {

      if (
        current &&
        typeof current === "object" &&
        segment in (current as Record<string, unknown>)
      ) {
        return (current as Record<string, unknown>)[segment];
      }

      return undefined;

    }, source);

}
