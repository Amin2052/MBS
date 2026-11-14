import { useEffect, useState } from "react";

import { CURRENCIES } from "@/constants/currency";
import { LANGUAGES } from "@/i18n";
import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";
import { useLanguage } from "@/hooks/use-language";
import { useCurrency } from "@/hooks/use-currency";
import { setDateFormatPreference } from "@/utils/date-format";
import { setNumberFormatPreference } from "@/utils/format-number";

import type { CompanySettings } from "@/types/company-settings";

import SettingsShell from "./settings-shell";

const TIMEZONES = [
  "Asia/Dhaka",
  "Asia/Riyadh",
  "Asia/Dubai",
  "UTC",
  "Europe/London",
  "America/New_York"
];

export default function LocalizationPage(): JSX.Element {

  // These apply the saved preferences app-wide immediately (mirroring
  // how the rest of the app already reads them), so Save here is not
  // just persisting an unused database column.
  const { setLanguage, t } = useLanguage();
  const { setCurrency } = useCurrency();

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

      console.error("Failed to load localization settings:", error);

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

      // Persisted to SQLite above; now make the change take effect
      // immediately across the app instead of only on next restart.
      setLanguage(settings.language);
      setCurrency(settings.currency);
      setDateFormatPreference(settings.dateFormat);
      setNumberFormatPreference(settings.numberFormat);

      setSavedMessage(true);

    }
    catch (error) {

      console.error("Failed to save localization settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsLocalization.title")} description={t("settingsLocalization.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsLocalization.title")}
      description={t("settingsLocalization.description")}
    >

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsLocalization.currency")}</label>
          <select
            value={settings.currency}
            onChange={(e) => updateField("currency", e.target.value as CompanySettings["currency"])}
          >
            {Object.values(CURRENCIES).map(currency => (
              <option key={currency.code} value={currency.code}>
                {currency.symbol} {currency.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t("settingsLocalization.language")}</label>
          <select
            value={settings.language}
            onChange={(e) => updateField("language", e.target.value as CompanySettings["language"])}
          >
            {Object.values(LANGUAGES).map(language => (
              <option key={language.code} value={language.code}>
                {language.flag} {language.label}
              </option>
            ))}
          </select>
        </div>

      </div>

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsLocalization.timezone")}</label>
          <select
            value={settings.timezone}
            onChange={(e) => updateField("timezone", e.target.value)}
          >
            {TIMEZONES.map(zone => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t("settingsLocalization.dateFormat")}</label>
          <select
            value={settings.dateFormat}
            onChange={(e) => updateField("dateFormat", e.target.value as CompanySettings["dateFormat"])}
          >
            <option value="DMY">31 Dec 2026 (DD MMM YYYY)</option>
            <option value="MDY">12/31/2026 (MM/DD/YYYY)</option>
            <option value="YMD">2026-12-31 (YYYY-MM-DD)</option>
          </select>
        </div>

        <div className="form-group">
          <label>{t("settingsLocalization.numberFormat")}</label>
          <select
            value={settings.numberFormat}
            onChange={(e) => updateField("numberFormat", e.target.value as CompanySettings["numberFormat"])}
          >
            <option value="en-US">1,234.56 (US)</option>
            <option value="en-IN">1,23,456.78 (Indian)</option>
            <option value="de-DE">1.234,56 (European)</option>
          </select>
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
        <div className="settings-save-confirmation">{t("settingsLocalization.savedConfirmation")}</div>
      )}


    </SettingsShell>
  );

}
