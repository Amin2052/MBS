export type ThemeMode = "light" | "dark" | "system";

export type ResolvedThemeMode = "light" | "dark";

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}
