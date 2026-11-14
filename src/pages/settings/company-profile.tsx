import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function CompanyProfilePage(): JSX.Element {

  const { t } = useLanguage();
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadSettings() {

    setIsLoading(true);

    try {

      const data = await window.mooral.settings.get();

      setSettings({
        ...DEFAULT_COMPANY_SETTINGS,
        ...data
      });

      if (data?.hasLogo || data?.logoPath) {

        const preview = await window.mooral.settings.getLogoPreview();
        setLogoPreview(preview || null);

      }
      else {

        setLogoPreview(null);

      }

    }
    catch (error) {

      console.error("Failed to load company settings:", error);

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
    setErrorMessage(null);

  }

  function validateSettings(): string | null {

    if (!settings.companyName.trim()) {
      return t("settingsCompanyProfile.companyNameRequired");
    }

    const email = settings.email.trim();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return t("settingsCompanyProfile.invalidEmail");
    }

    const website = settings.website.trim();

    if (website && !/^(https?:\/\/)?[^\s.]+(\.[^\s.]+)+.*$/.test(website)) {
      return t("settingsCompanyProfile.invalidWebsite");
    }

    return null;

  }

  async function handleUploadLogo() {

    setIsUploadingLogo(true);

    try {

      const preview = await window.mooral.settings.uploadLogo();

      if (preview) {

        setLogoPreview(preview);
        setSettings(prev => ({ ...prev, hasLogo: true, logoPath: "stored-in-database" }));

      }

    }
    catch (error) {

      console.error("Failed to upload logo", error);

    }
    finally {

      setIsUploadingLogo(false);

    }

  }

  async function handleRemoveLogo() {

    const confirmed = window.confirm(t("settingsCompanyProfile.removeLogoConfirm"));

    if (!confirmed) {
      return;
    }

    setIsRemovingLogo(true);

    try {

      const result = await window.mooral.settings.removeLogo();

      if (result?.success) {

        setLogoPreview(null);
        setSettings(prev => ({ ...prev, hasLogo: false, logoPath: null }));

      }
      else {

        setErrorMessage(t("settingsCompanyProfile.removeLogoError"));

      }

    }
    catch (error) {

      console.error("Failed to remove logo", error);
      setErrorMessage(t("settingsCompanyProfile.removeLogoError"));

    }
    finally {

      setIsRemovingLogo(false);

    }

  }

  async function handleSave() {

    const validationError = validateSettings();

    if (validationError) {

      setErrorMessage(validationError);
      setSavedMessage(false);
      return;

    }

    setErrorMessage(null);
    setIsSaving(true);

    try {

      await window.mooral.settings.save(settings);
      setSavedMessage(true);

    }
    catch (error) {

      console.error("Failed to save company profile", error);
      setErrorMessage(t("settingsCompanyProfile.saveError"));

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsCompanyProfile.title")} description={t("settingsCompanyProfile.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsCompanyProfile.title")}
      description={t("settingsCompanyProfile.description")}
    >

      <div className="form-group">

        <label>{t("settingsCompanyProfile.companyLogo")}</label>

        <div className="logo-frame-row">

          <div className="logo-preview-box">

            {logoPreview
              ? <img src={logoPreview} alt="Company Logo" />
              : <span className="logo-preview-empty">{t("settingsCompanyProfile.noLogoUploaded")}</span>}

          </div>

          <div className="logo-actions">

            <button
              type="button"
              className="logo-select-button"
              onClick={handleUploadLogo}
              disabled={isUploadingLogo || isRemovingLogo}
            >
              {isUploadingLogo ? t("settingsCompanyProfile.uploading") : t("settingsCompanyProfile.uploadLogo")}
            </button>

            {logoPreview && (
              <button
                type="button"
                className="logo-select-button danger"
                onClick={handleRemoveLogo}
                disabled={isUploadingLogo || isRemovingLogo}
              >
                {isRemovingLogo ? t("settingsCompanyProfile.removing") : t("settingsCompanyProfile.removeLogo")}
              </button>
            )}

          </div>

        </div>

        <p className="settings-section-description logo-preview-note">
          {t("settingsCompanyProfile.logoRecommendation")}
        </p>

      </div>

      <div className="form-group">
        <label>{t("settingsCompanyProfile.companyName")}</label>
        <input
          value={settings.companyName}
          onChange={(e) => updateField("companyName", e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>{t("settingsCompanyProfile.address")}</label>
        <input
          value={settings.address}
          onChange={(e) => updateField("address", e.target.value)}
        />
      </div>

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsCompanyProfile.phone")}</label>
          <input
            value={settings.phone}
            onChange={(e) => updateField("phone", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>{t("settingsCompanyProfile.email")}</label>
          <input
            value={settings.email}
            onChange={(e) => updateField("email", e.target.value)}
          />
        </div>

      </div>

      <div className="form-grid">

        <div className="form-group">
          <label>{t("settingsCompanyProfile.website")}</label>
          <input
            value={settings.website}
            placeholder="https://example.com"
            onChange={(e) => updateField("website", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>{t("settingsCompanyProfile.taxId")}</label>
          <input
            value={settings.taxId}
            onChange={(e) => updateField("taxId", e.target.value)}
          />
        </div>

      </div>

      <div className="form-group">
        <label>{t("settingsCompanyProfile.invoiceFooter")}</label>
        <textarea
          rows={3}
          value={settings.invoiceFooter}
          onChange={(e) => updateField("invoiceFooter", e.target.value)}
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
        <div className="settings-save-confirmation">{t("settingsCompanyProfile.savedConfirmation")}</div>
      )}

      {errorMessage && (
        <div className="settings-error-message" role="alert" aria-live="assertive">
          {errorMessage}
        </div>
      )}

    </SettingsShell>
  );

}
