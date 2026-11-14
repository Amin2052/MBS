export type AppTheme = "light" | "dark";

/**
 * Duplicated here (rather than imported from electron/main/license/types)
 * so shared/types stays free of any dependency on the license module's
 * internal folder structure -- shared/types is imported by config.ts,
 * window-state.ts, and potentially renderer code, none of which should
 * need to reach into electron/main/license just for this string union.
 * LicenseFactory and LicenseManager import the canonical definition
 * from electron/main/license/types/license-types.ts.
 */
export type AppLicenseMode = "offline" | "online" | "hybrid";

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

export interface AppConfig {
  language: string;
  theme: AppTheme;
  databasePath: string;
  backupPath: string;
  /** Which licensing provider LicenseFactory should construct. Defaults to "offline". */
  licenseMode: AppLicenseMode;
  supportWhatsAppNumber: string;
  supportEmail: string;
}
