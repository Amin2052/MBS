import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { AppConfig } from "../../shared/types/config";

const CONFIG_FILE = path.join(
  app.getPath("userData"),
  "config.json"
);

const DEFAULT_CONFIG: AppConfig = {
  language: "en",
  theme: "light",
  databasePath: "",
  backupPath: "",
  licenseMode: "offline",
  supportWhatsAppNumber: "+8801863036547",
  supportEmail: "alamin2052@gmail.com"
};

export class ConfigManager {
  static load(): AppConfig {
    try {
      if (!fs.existsSync(CONFIG_FILE)) {
        this.save(DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
      }

      const loaded = JSON.parse(
        fs.readFileSync(CONFIG_FILE, "utf-8")
      ) as Partial<AppConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...loaded,
        supportWhatsAppNumber: (loaded.supportWhatsAppNumber ?? "").trim() || DEFAULT_CONFIG.supportWhatsAppNumber,
        supportEmail: (loaded.supportEmail ?? "").trim() || DEFAULT_CONFIG.supportEmail
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  static save(config: AppConfig): void {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2),
      "utf-8"
    );
  }
}
