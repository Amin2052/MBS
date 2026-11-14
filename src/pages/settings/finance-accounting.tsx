import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function FinanceAccountingSettingsPage(): JSX.Element {

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

      console.error("Failed to load accounting preferences:", error);

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

      console.error("Failed to save accounting preferences", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsFinanceAccounting.title")} description={t("settingsFinanceAccounting.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsFinanceAccounting.title")}
      description={t("settingsFinanceAccounting.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsFinanceAccounting.fiscalYearTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsFinanceAccounting.fiscalYearStart")}</label>
            <input
              value={settings.fiscalYearStart}
              onChange={(e) => updateField("fiscalYearStart", e.target.value)}
              placeholder="01-01"
            />
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsFinanceAccounting.taxSettingsTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsFinanceAccounting.defaultTaxRate")}</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings.accountingDefaultTaxRate}
              onChange={(e) => updateField("accountingDefaultTaxRate", e.target.value === "" ? 0 : Number(e.target.value))}
              placeholder="0"
            />
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsFinanceAccounting.paymentPostingTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsFinanceAccounting.defaultPaymentMethod")}</label>
            <select
              value={settings.accountingDefaultPaymentMethod}
              onChange={(e) => updateField("accountingDefaultPaymentMethod", e.target.value)}
            >
              <option value="Cash">Cash</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Mobile Banking">Mobile Banking</option>
              <option value="Cheque">Cheque</option>
              <option value="Card">Card</option>
            </select>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.accountingAutoPostJournal}
                onChange={(e) => updateField("accountingAutoPostJournal", e.target.checked)}
              />
              {t("settingsFinanceAccounting.autoPostJournal")}
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
        <div className="settings-save-confirmation">{t("settingsFinanceAccounting.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
