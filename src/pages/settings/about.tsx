import { useEffect, useState } from "react";

import { formatDateTime } from "@/utils/date-format";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function AboutPage(): JSX.Element {

  const { t } = useLanguage();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [prefs, setPrefs] = useState<{ automaticUpdateChecks: boolean; launchOnStartup: boolean; crashErrorReporting: boolean } | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  async function loadInfo() {

    setIsLoading(true);

    try {

      const [app, database, appPrefs] = await Promise.all([
        window.mooral.app.getInfo(),
        window.mooral.database.getInfo(),
        window.mooral.appPreferences.get()
      ]);

      setAppInfo(app);
      setDbInfo(database);
      setPrefs(appPrefs);

    }
    catch (error) {

      console.error("Failed to load application info:", error);

    }
    finally {

      setIsLoading(false);

    }

  }

  useEffect(() => {

    loadInfo();

  }, []);

  async function togglePref(key: "automaticUpdateChecks" | "launchOnStartup" | "crashErrorReporting") {

    if (!prefs || savingKey) return;

    const nextValue = !prefs[key];

    setSavingKey(key);

    try {

      const updated = await window.mooral.appPreferences.set(key, nextValue);
      setPrefs(updated);

    }
    catch (error) {

      console.error(`Failed to update ${key}:`, error);

    }
    finally {

      setSavingKey(null);

    }

  }

  async function handleCheckForUpdates() {

    setCheckingUpdate(true);
    setUpdateMessage(null);

    try {

      const result = await window.mooral.appPreferences.checkForUpdatesNow();
      setUpdateMessage(result.message);

    }
    catch (error) {

      setUpdateMessage(error instanceof Error ? error.message : "Unable to check for updates right now.");

    }
    finally {

      setCheckingUpdate(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsAbout.title")} description={t("settingsAbout.description")}>
        <p>{t("settingsAbout.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsAbout.title")}
      description={t("settingsAbout.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsAbout.appInfoTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsAbout.appInfoDescription")}
        </p>

        <div className="db-info-grid">

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsAbout.appName")}</div>
            <div className="db-info-card-value">{appInfo?.appName ?? "-"}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsAbout.appVersion")}</div>
            <div className="db-info-card-value">{appInfo?.appVersion ?? "-"}</div>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsAbout.dbVersionTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsAbout.dbVersionDescription")}
        </p>

        <div className="db-info-grid">

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsAbout.fileLocation")}</div>
            <div className="db-info-card-value">{dbInfo?.path ?? "-"}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsAbout.lastModified")}</div>
            <div className="db-info-card-value">{formatDateTime(dbInfo?.lastModified)}</div>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsAbout.systemInfoTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsAbout.systemInfoDescription")}
        </p>

        <div className="db-info-grid">

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsAbout.platform")}</div>
            <div className="db-info-card-value">
              {appInfo?.platform ?? "-"} ({appInfo?.arch ?? "-"})
            </div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsAbout.electronNode")}</div>
            <div className="db-info-card-value">
              {appInfo?.electronVersion ?? "-"} / {appInfo?.nodeVersion ?? "-"}
            </div>
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsAbout.preferencesTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsAbout.preferencesDescription")}
        </p>

        <div className="app-pref-toggle">
          <div className="app-pref-toggle-label">
            <span className="app-pref-toggle-title">{t("settingsAbout.automaticUpdateChecks")}</span>
            <span className="app-pref-toggle-description">{t("settingsAbout.automaticUpdateChecksDescription")}</span>
          </div>
          <button
            type="button"
            className="app-pref-switch"
            role="switch"
            aria-checked={!!prefs?.automaticUpdateChecks}
            disabled={savingKey === "automaticUpdateChecks"}
            onClick={() => togglePref("automaticUpdateChecks")}
          />
        </div>

        <div className="app-pref-toggle">
          <div className="app-pref-toggle-label">
            <span className="app-pref-toggle-title">{t("settingsAbout.launchOnStartup")}</span>
            <span className="app-pref-toggle-description">{t("settingsAbout.launchOnStartupDescription")}</span>
          </div>
          <button
            type="button"
            className="app-pref-switch"
            role="switch"
            aria-checked={!!prefs?.launchOnStartup}
            disabled={savingKey === "launchOnStartup"}
            onClick={() => togglePref("launchOnStartup")}
          />
        </div>

        <div className="app-pref-toggle">
          <div className="app-pref-toggle-label">
            <span className="app-pref-toggle-title">{t("settingsAbout.crashErrorReporting")}</span>
            <span className="app-pref-toggle-description">{t("settingsAbout.crashErrorReportingDescription")}</span>
          </div>
          <button
            type="button"
            className="app-pref-switch"
            role="switch"
            aria-checked={!!prefs?.crashErrorReporting}
            disabled={savingKey === "crashErrorReporting"}
            onClick={() => togglePref("crashErrorReporting")}
          />
        </div>

        <div className="app-pref-update-row">
          <button
            type="button"
            className="db-action-button secondary"
            disabled={checkingUpdate}
            onClick={handleCheckForUpdates}
          >
            {checkingUpdate ? t("settingsAbout.checkingForUpdates") : t("settingsAbout.checkForUpdatesNow")}
          </button>
          {updateMessage && <span className="app-pref-update-message">{updateMessage}</span>}
        </div>

      </div>

    </SettingsShell>
  );

}
