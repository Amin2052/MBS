import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function InventorySettingsPage(): JSX.Element {

  const { t } = useLanguage();
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);

  async function loadSettings() {

    setIsLoading(true);

    try {

      const data = await window.mooral.settings.get();

      setSettings({
        ...DEFAULT_COMPANY_SETTINGS,
        ...data
      });

    }
    catch (error) {

      console.error("Failed to load stock settings:", error);

    }
    finally {

      setIsLoading(false);

    }

  }

  useEffect(() => {

    loadSettings();

  }, []);

  function updateField<K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) {

    setSettings(prev => ({ ...prev, [key]: value }));
    setSavedMessage(false);

  }

  async function handleSave() {

    setIsSaving(true);

    try {

      await window.mooral.settings.save(settings);
      setSavedMessage(true);

    }
    catch (error) {

      console.error("Failed to save stock settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsInventory.title")} description={t("settingsInventory.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsInventory.title")}
      description={t("settingsInventory.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsInventory.stockSettingsTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsInventory.stockSettingsDescription")}
        </p>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsInventory.lowStockThreshold")}</label>
            <input
              type="number"
              min="0"
              value={settings.stockLowThreshold}
              onChange={(e) => updateField("stockLowThreshold", e.target.value === "" ? 0 : Number(e.target.value))}
              placeholder="10"
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.stockAutoReorderAlert}
                onChange={(e) => updateField("stockAutoReorderAlert", e.target.checked)}
              />
              {t("settingsInventory.automaticLowStockAlerts")}
            </label>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsInventory.warehouseConfigTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsInventory.defaultWarehouse")}</label>
            <input
              value={settings.stockDefaultWarehouse}
              onChange={(e) => updateField("stockDefaultWarehouse", e.target.value)}
              placeholder={t("settingsInventory.mainWarehousePlaceholder")}
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.stockAllowNegative}
                onChange={(e) => updateField("stockAllowNegative", e.target.checked)}
              />
              {t("settingsInventory.allowNegativeStock")}
            </label>
          </div>

        </div>

      </div>

      <div className="settings-actions">

        <button className="save-settings" onClick={handleSave} disabled={isSaving}>
          {isSaving ? t("settingsCommon.saving") : t("settingsCommon.saveChanges")}
        </button>

        <button className="reset-settings" onClick={loadSettings} disabled={isSaving}>
          {t("settingsCommon.discardChanges")}
        </button>

      </div>

      {savedMessage && (
        <div className="settings-save-confirmation">{t("settingsInventory.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
