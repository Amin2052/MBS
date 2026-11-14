export const THEME_STORAGE_KEY = "mooral.theme";

// Graphite Atelier is the product's default appearance: a fresh install opens
// in the dark palette. "system" remains a selectable mode, and an existing
// stored preference (including "light") is always respected by
// theme-provider's readStoredTheme(), so nobody is forced out of light mode.
export const DEFAULT_THEME = "dark";
