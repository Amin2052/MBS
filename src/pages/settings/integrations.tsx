import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function IntegrationsSettingsPage(): JSX.Element {

  const { t } = useLanguage();
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [cloud, setCloud] = useState<{
    enabled: boolean; licensed: boolean; mode: "developer_managed" | "customer_managed";
    apiUrl: string; workspaceId: string; apiKey: string; apiKeyMasked: string;
  }>({ enabled: false, licensed: false, mode: "developer_managed", apiUrl: "", workspaceId: "", apiKey: "", apiKeyMasked: "" });
  const [cloudStatus, setCloudStatus] = useState<string>("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [showCustomerApiKey, setShowCustomerApiKey] = useState(false);
  const [customerCloudSaving, setCustomerCloudSaving] = useState(false);
  // Editable draft for the customer_managed fields -- kept separate from
  // `cloud` so typing doesn't look "saved" until Save Server is clicked.
  const [customerCloudDraft, setCustomerCloudDraft] = useState({ apiUrl: "", workspaceId: "", apiKey: "" });

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

      console.error("Failed to load integration settings:", error);

    }
    finally {

      setIsLoading(false);

    }

    try {
      const cloudConfig = await window.mooral.cloud.getConfig();
      setCloud(cloudConfig);
      if (cloudConfig.mode === "customer_managed") {
        setCustomerCloudDraft({
          apiUrl: cloudConfig.apiUrl,
          workspaceId: cloudConfig.workspaceId,
          apiKey: cloudConfig.apiKey
        });
      }
    } catch (error) {
      console.error("Failed to load cloud configuration:", error);
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
      await window.mooral.cloud.saveConfig({ enabled: cloud.enabled });
      setSavedMessage(true);

    }
    catch (error) {

      console.error("Failed to save integration settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsIntegrations.title")} description={t("settingsIntegrations.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsIntegrations.title")}
      description={t("settingsIntegrations.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsIntegrations.externalServicesTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsIntegrations.externalServicesDescription")}
        </p>

        <div className="form-grid">

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.integrationEnabled}
                onChange={(e) => updateField("integrationEnabled", e.target.checked)}
              />
              {t("settingsIntegrations.enableExternalIntegrations")}
            </label>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsIntegrations.apiConfigurationTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsIntegrations.apiKey")}</label>
            <input
              type={showApiKey ? "text" : "password"}
              disabled={!settings.integrationEnabled}
              value={settings.integrationApiKey}
              onChange={(e) => updateField("integrationApiKey", e.target.value)}
              placeholder={t("settingsIntegrations.enterApiKey")}
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label>{t("settingsIntegrations.webhookUrl")}</label>
            <input
              disabled={!settings.integrationEnabled}
              value={settings.integrationWebhookUrl}
              onChange={(e) => updateField("integrationWebhookUrl", e.target.value)}
              placeholder="https://example.com/webhook"
            />
          </div>

        </div>

        <div className="form-grid">

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={showApiKey}
                onChange={(e) => setShowApiKey(e.target.checked)}
              />
              {t("settingsIntegrations.showApiKey")}
            </label>
          </div>

        </div>

      </div>


      <div className="settings-section">
        <h3>Online Database & Internal Messaging</h3>
        <p className="settings-section-description">Connect this offline-first MBS installation to the Cloudflare central MBS API. Local SQLite remains the offline cache; central D1 stores shared online data.</p>

        <div className="form-grid">
          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                disabled={!cloud.licensed}
                checked={cloud.enabled}
                onChange={(e) => setCloud(prev => ({ ...prev, enabled: e.target.checked }))}
              />
              Enable MBS Cloud
            </label>
          </div>
        </div>

        {!cloud.licensed && (
          <p className="settings-section-description">
            No cloud configuration is included in the active license. Contact your MBS provider to enable
            this feature.
          </p>
        )}

        {cloud.licensed && cloud.mode === "developer_managed" && (
          <>
            <div className="form-grid">
              <div className="form-group">
                <label>Status</label>
                <input readOnly disabled value="Configured (Licensed)" />
              </div>
              <div className="form-group">
                <label>Cloud API URL</label>
                <input readOnly disabled value={cloud.apiUrl || "—"} />
              </div>
              <div className="form-group">
                <label>Workspace ID</label>
                <input readOnly disabled value={cloud.workspaceId || "—"} />
              </div>
              <div className="form-group">
                <label>Cloud API Key</label>
                <input readOnly disabled value={cloud.apiKeyMasked || "—"} />
              </div>
              <div className="form-group">
                <label>Mode</label>
                <input readOnly disabled value="Licensed Configuration" />
              </div>
            </div>
            <p className="settings-section-description">
              This configuration is managed by your licensed developer configuration and cannot be edited here.
            </p>
          </>
        )}

        {cloud.licensed && cloud.mode === "customer_managed" && (
          <>
            <p className="settings-section-description">
              Your license lets you connect your own personal or self-hosted server. Enter its details below —
              they're stored only on this computer and are never sent to your MBS provider.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label>Cloud API URL</label>
                <input
                  value={customerCloudDraft.apiUrl}
                  onChange={(e) => setCustomerCloudDraft(prev => ({ ...prev, apiUrl: e.target.value }))}
                  placeholder="https://your-server:8787"
                />
              </div>
              <div className="form-group">
                <label>Workspace ID</label>
                <input
                  value={customerCloudDraft.workspaceId}
                  onChange={(e) => setCustomerCloudDraft(prev => ({ ...prev, workspaceId: e.target.value }))}
                  placeholder="company-001"
                />
              </div>
              <div className="form-group">
                <label>Cloud API Key</label>
                <input
                  type={showCustomerApiKey ? "text" : "password"}
                  value={customerCloudDraft.apiKey}
                  onChange={(e) => setCustomerCloudDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="Your server's API key"
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label>Mode</label>
                <input readOnly disabled value="Personal Server (Customer-Managed)" />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={showCustomerApiKey}
                    onChange={(e) => setShowCustomerApiKey(e.target.checked)}
                  />
                  Show API key
                </label>
              </div>
            </div>
            <div className="settings-actions">
              <button
                className="save-settings"
                disabled={customerCloudSaving}
                onClick={async () => {
                  setCustomerCloudSaving(true);
                  setCloudStatus("");
                  try {
                    const updated = await window.mooral.cloud.saveCustomerConfig(customerCloudDraft);
                    setCloud(updated);
                    setCloudStatus("Personal server saved.");
                  } catch (error) {
                    setCloudStatus(error instanceof Error ? error.message : String(error));
                  } finally {
                    setCustomerCloudSaving(false);
                  }
                }}
              >
                {customerCloudSaving ? "Saving…" : "Save Server"}
              </button>
            </div>
          </>
        )}

        {cloud.licensed && (
          <div className="settings-actions">
            <button
              className="save-settings"
              disabled={cloudBusy || !cloud.enabled || !cloud.licensed}
              onClick={async () => {
                setCloudBusy(true);
                setCloudStatus("");
                try {
                  await window.mooral.cloud.saveConfig({ enabled: cloud.enabled });
                  const result = await window.mooral.cloud.health();
                  setCloudStatus(result.success ? "Cloud connection OK." : `Cloud connection failed: ${result.detail}`);
                } catch (error) {
                  setCloudStatus(error instanceof Error ? error.message : String(error));
                } finally {
                  setCloudBusy(false);
                }
              }}
            >
              Test Connection
            </button>
            <button
              className="save-settings"
              disabled={cloudBusy || !cloud.enabled || !cloud.licensed}
              onClick={async () => {
                setCloudBusy(true);
                setCloudStatus("");
                try {
                  await window.mooral.cloud.saveConfig({ enabled: cloud.enabled });
                  const result = await window.mooral.cloud.syncNow();
                  setCloudStatus(result.success ? "Central cloud sync completed." : (result.error ?? "Cloud sync failed."));
                } catch (error) {
                  setCloudStatus(error instanceof Error ? error.message : String(error));
                } finally {
                  setCloudBusy(false);
                }
              }}
            >
              Sync Now
            </button>
          </div>
        )}
        {cloudStatus && <div className="settings-save-confirmation">{cloudStatus}</div>}
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
        <div className="settings-save-confirmation">{t("settingsIntegrations.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
