import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function DocumentTemplatesSettingsPage(): JSX.Element {

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

      console.error("Failed to load document template settings:", error);

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

      console.error("Failed to save document template settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsDocumentTemplates.title")} description={t("settingsDocumentTemplates.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsDocumentTemplates.title")}
      description={t("settingsDocumentTemplates.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsDocumentTemplates.invoiceTemplateTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsDocumentTemplates.templateStyle")}</label>
            <select
              value={settings.invoiceTemplateStyle}
              onChange={(e) => updateField("invoiceTemplateStyle", e.target.value)}
            >
              <option value="classic">{t("settingsDocumentTemplates.classic")}</option>
              <option value="compact">{t("settingsDocumentTemplates.compact")}</option>
              <option value="modern">{t("settingsDocumentTemplates.modern")}</option>
            </select>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsDocumentTemplates.reportTemplateTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsDocumentTemplates.templateStyle")}</label>
            <select
              value={settings.reportTemplateStyle}
              onChange={(e) => updateField("reportTemplateStyle", e.target.value)}
            >
              <option value="classic">{t("settingsDocumentTemplates.classic")}</option>
              <option value="compact">{t("settingsDocumentTemplates.compact")}</option>
              <option value="modern">{t("settingsDocumentTemplates.modern")}</option>
            </select>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsDocumentTemplates.brandingTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsDocumentTemplates.brandingDescription")}
        </p>

        <div className="form-grid">

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.documentShowLogo}
                onChange={(e) => updateField("documentShowLogo", e.target.checked)}
              />
              {t("settingsDocumentTemplates.showLogo")}
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
        <div className="settings-save-confirmation">{t("settingsDocumentTemplates.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
