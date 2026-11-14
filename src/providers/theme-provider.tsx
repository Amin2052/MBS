import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/constants/theme";
import type {
  ResolvedThemeMode,
  ThemeContextValue,
  ThemeMode
} from "@/types/theme";

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined
);

function getSystemTheme(): ResolvedThemeMode {

  if (
    typeof window !== "undefined" &&
    window.matchMedia
  ) {

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  }

  return "light";

}

function resolveTheme(theme: ThemeMode): ResolvedThemeMode {

  if (theme === "system") {
    return getSystemTheme();
  }

  return theme;

}

function readStoredTheme(): ThemeMode {

  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);

  if (
    storedTheme === "light" ||
    storedTheme === "dark" ||
    storedTheme === "system"
  ) {
    return storedTheme;
  }

  return DEFAULT_THEME as ThemeMode;

}

export function ThemeProvider({
  children
}: PropsWithChildren): JSX.Element {

  // The initial value is applied to <html data-theme> synchronously by the
  // inline script in index.html, before React mounts, so there is no
  // flash of the wrong theme. This state simply mirrors that value.
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedThemeMode>(() =>
    resolveTheme(theme)
  );

  useEffect(() => {

    const resolved = resolveTheme(theme);

    setResolvedTheme(resolved);

    document.documentElement.setAttribute("data-theme", resolved);
    localStorage.setItem(THEME_STORAGE_KEY, theme);

  }, [theme]);

  useEffect(() => {

    if (theme !== "system" || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      const resolved = getSystemTheme();
      setResolvedTheme(resolved);
      document.documentElement.setAttribute("data-theme", resolved);
    };

    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };

  }, [theme]);

  const setTheme = useCallback((value: ThemeMode) => {
    setThemeState(value);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const currentResolved = resolveTheme(current);
      return currentResolved === "light" ? "dark" : "light";
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme
    }),
    [theme, resolvedTheme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
