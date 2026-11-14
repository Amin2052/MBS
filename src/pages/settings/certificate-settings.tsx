import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function CertificateSettingsPage(): JSX.Element {

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

      console.error("Failed to load certificate settings:", error);

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

      console.error("Failed to save certificate settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsCertificate.title")} description={t("settingsCertificate.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsCertificate.title")}
      description={t("settingsCertificate.description")}
    >

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsCertificate.employeePrefix")}</label>
          <input
            value={settings.certificateEmployeePrefix}
            onChange={(e) => updateField("certificateEmployeePrefix", e.target.value)}
            placeholder="EMP-"
          />
        </div>

        <div className="form-group">
          <label>{t("settingsCertificate.productPrefix")}</label>
          <input
            value={settings.certificateProductPrefix}
            onChange={(e) => updateField("certificateProductPrefix", e.target.value)}
            placeholder="PRD-"
          />
        </div>

      </div>

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsCertificate.authorizedSignatureName")}</label>
          <input
            value={settings.certificateAuthorizedSignature}
            onChange={(e) => updateField("certificateAuthorizedSignature", e.target.value)}
            placeholder="e.g. Aminul Hoque"
          />
        </div>

        <div className="form-group">
          <label>{t("settingsCertificate.authorizedDesignation")}</label>
          <input
            value={settings.certificateAuthorizedDesignation}
            onChange={(e) => updateField("certificateAuthorizedDesignation", e.target.value)}
            placeholder="e.g. Managing Director"
          />
        </div>

      </div>

      <div className="form-group">
        <label>{t("settingsCertificate.footerText")}</label>
        <textarea
          rows={2}
          value={settings.certificateFooterText}
          onChange={(e) => updateField("certificateFooterText", e.target.value)}
          placeholder={t("settingsCertificate.footerTextPlaceholder")}
        />
      </div>

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsCertificate.defaultTemplate")}</label>
          <select
            value={settings.certificateDefaultTemplate}
            onChange={(e) => updateField("certificateDefaultTemplate", e.target.value)}
          >
            <option value="classic">{t("settingsCertificate.classic")}</option>
          </select>
        </div>

        <div className="form-group">
          <label>{t("settingsCertificate.defaultValidityDays")}</label>
          <input
            type="number"
            min="0"
            disabled={!settings.certificateEnableExpiry}
            value={settings.certificateDefaultValidityDays}
            onChange={(e) => updateField("certificateDefaultValidityDays", e.target.value === "" ? 0 : Number(e.target.value))}
            placeholder={t("settingsCertificate.noDefault")}
          />
        </div>

      </div>

      <div className="form-grid">

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.certificateAutoNumbering}
              onChange={(e) => updateField("certificateAutoNumbering", e.target.checked)}
            />
            {t("settingsCertificate.autoNumbering")}
          </label>
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.certificateQrVerification}
              onChange={(e) => updateField("certificateQrVerification", e.target.checked)}
            />
            {t("settingsCertificate.qrVerification")}
          </label>
        </div>

      </div>

      <div className="form-grid">

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.certificateEnableExpiry}
              onChange={(e) => updateField("certificateEnableExpiry", e.target.checked)}
            />
            {t("settingsCertificate.enableExpiry")}
          </label>
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.certificateReuseCompanyLogo}
              onChange={(e) => updateField("certificateReuseCompanyLogo", e.target.checked)}
            />
            {t("settingsCertificate.reuseCompanyLogo")}
          </label>
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
        <div className="settings-save-confirmation">{t("settingsCertificate.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
