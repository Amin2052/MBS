import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function NotificationsSettingsPage(): JSX.Element {

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

      console.error("Failed to load notification settings:", error);

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

      console.error("Failed to save notification settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsNotifications.title")} description={t("settingsNotifications.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsNotifications.title")}
      description={t("settingsNotifications.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsNotifications.emailNotificationsTitle")}</h3>

        <div className="form-grid">

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.notifyEmailEnabled}
                onChange={(e) => updateField("notifyEmailEnabled", e.target.checked)}
              />
              {t("settingsNotifications.enableEmailNotifications")}
            </label>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsNotifications.systemAlertsTitle")}</h3>

        <div className="form-grid">

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                disabled={!settings.notifyEmailEnabled}
                checked={settings.notifyLowStock}
                onChange={(e) => updateField("notifyLowStock", e.target.checked)}
              />
              {t("settingsNotifications.lowStockAlerts")}
            </label>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                disabled={!settings.notifyEmailEnabled}
                checked={settings.notifyOrderUpdates}
                onChange={(e) => updateField("notifyOrderUpdates", e.target.checked)}
              />
              {t("settingsNotifications.orderStatusUpdates")}
            </label>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                disabled={!settings.notifyEmailEnabled}
                checked={settings.notifyPaymentDue}
                onChange={(e) => updateField("notifyPaymentDue", e.target.checked)}
              />
              {t("settingsNotifications.paymentDueReminders")}
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
        <div className="settings-save-confirmation">{t("settingsNotifications.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
