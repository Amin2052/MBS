import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";
import SettingsComingSoon from "./settings-coming-soon";

export default function FinancialInvoicePage(): JSX.Element {

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

      console.error("Failed to load financial settings:", error);

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

      console.error("Failed to save financial & invoice settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsFinancialInvoice.title")} description={t("settingsFinancialInvoice.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsFinancialInvoice.title")}
      description={t("settingsFinancialInvoice.description")}
    >

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsFinancialInvoice.invoicePrefix")}</label>
          <input
            value={settings.invoicePrefix}
            onChange={(e) => updateField("invoicePrefix", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>{t("settingsFinancialInvoice.taxRate")}</label>
          <input
            type="number"
            value={settings.taxRate === 0 ? "" : settings.taxRate}
            onChange={(e) => updateField("taxRate", e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </div>

      </div>

      <div className="form-group">
        <label>{t("settingsFinancialInvoice.paymentTerms")}</label>
        <textarea
          rows={3}
          value={settings.paymentTerms}
          onChange={(e) => updateField("paymentTerms", e.target.value)}
        />
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
        <div className="settings-save-confirmation">{t("settingsFinancialInvoice.savedConfirmation")}</div>
      )}

      <div style={{ marginTop: 28, borderTop: "1px solid #e5e7eb", paddingTop: 20 }}>
        <SettingsComingSoon items={[t("settingsFinancialInvoice.invoiceFormat"), t("settingsFinancialInvoice.invoiceOptions")]} />
      </div>

    </SettingsShell>
  );

}
