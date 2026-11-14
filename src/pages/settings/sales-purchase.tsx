import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function SalesPurchaseSettingsPage(): JSX.Element {

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

      console.error("Failed to load sales & purchase settings:", error);

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

      console.error("Failed to save sales & purchase settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsSalesPurchase.title")} description={t("settingsSalesPurchase.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsSalesPurchase.title")}
      description={t("settingsSalesPurchase.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsSalesPurchase.documentNumberingTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsSalesPurchase.salesOrderPrefix")}</label>
            <input
              value={settings.salesOrderPrefix}
              onChange={(e) => updateField("salesOrderPrefix", e.target.value)}
              placeholder="ORD-"
            />
          </div>

          <div className="form-group">
            <label>{t("settingsSalesPurchase.purchaseOrderPrefix")}</label>
            <input
              value={settings.purchaseOrderPrefix}
              onChange={(e) => updateField("purchaseOrderPrefix", e.target.value)}
              placeholder="PO-"
            />
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsSalesPurchase.defaultPaymentTermsTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsSalesPurchase.salesPaymentTerms")}</label>
            <input
              value={settings.salesDefaultPaymentTerms}
              onChange={(e) => updateField("salesDefaultPaymentTerms", e.target.value)}
              placeholder={t("settingsSalesPurchase.dueOnReceipt")}
            />
          </div>

          <div className="form-group">
            <label>{t("settingsSalesPurchase.purchasePaymentTerms")}</label>
            <input
              value={settings.purchaseDefaultPaymentTerms}
              onChange={(e) => updateField("purchaseDefaultPaymentTerms", e.target.value)}
              placeholder={t("settingsSalesPurchase.net30")}
            />
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsSalesPurchase.orderBehaviourTitle")}</h3>

        <div className="form-grid">

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.salesRequireApproval}
                onChange={(e) => updateField("salesRequireApproval", e.target.checked)}
              />
              {t("settingsSalesPurchase.requireApproval")}
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
        <div className="settings-save-confirmation">{t("settingsSalesPurchase.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
