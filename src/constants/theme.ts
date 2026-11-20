export const THEME_STORAGE_KEY = "mooral.theme";

// Atelier Daylight is the product's default appearance: a fresh install opens
// in the light palette with white background. "system" remains a selectable mode,
// and an existing stored preference (including "dark") is always respected by
// theme-provider's readStoredTheme(), so nobody is forced out of dark mode.
export const DEFAULT_THEME = "light";
