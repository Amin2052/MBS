import { useEffect, useState } from "react";
import {
  Download,
  Upload,
  Wrench,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  HardDrive
} from "lucide-react";

import { formatDateTime } from "@/utils/date-format";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { exportBusinessData, importBusinessData } from "@/services/owner-control-service";
import ErpResetPanel from "@/components/settings/erp-reset-panel";

import SettingsShell from "./settings-shell";

function formatBytes(bytes: number): string {

  if (!bytes || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  const value = bytes / Math.pow(1024, exponent);

  return `${exponent === 0 ? value : value.toFixed(2)} ${units[exponent]}`;

}

function tableLabel(tableName: string): string {

  return tableName
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());

}

export default function DatabaseSettingsPage(): JSX.Element {

  const { t } = useLanguage();
  const { user } = useAuth();
  const isOwner = user?.user_type === "owner";

  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(true);

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isAppRestarting, setIsAppRestarting] = useState(false);
  const [isExportingData, setIsExportingData] = useState(false);
  const [isImportingData, setIsImportingData] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Every database action mutates the same on-disk SQLite file, so
  // only one may run at a time -- e.g. running VACUUM while a backup
  // is mid-copy, or starting a second backup while a restore is
  // closing/reopening the connection, is never safe. All buttons
  // below share this single guard instead of only checking their own
  // in-flight flag.
  const isBusy = isBackingUp || isRestoring || isVacuuming || isCheckingIntegrity || isAppRestarting || isExportingData || isImportingData;

  async function handleExportData(): Promise<void> {

    setIsExportingData(true);
    setStatusMessage(null);

    try {

      const result = await exportBusinessData();

      if (result.success) {
        setStatusMessage({ type: "success", text: `${t("settingsDatabase.dataExportedTo")} ${result.filePath}` });
      }
      else if (!result.cancelled) {
        setStatusMessage({ type: "error", text: result.error ?? t("settingsDatabase.exportFailed") });
      }

    }
    finally {

      setIsExportingData(false);

    }

  }

  async function handleImportData(): Promise<void> {

    setIsImportingData(true);
    setStatusMessage(null);

    try {

      const result = await importBusinessData();

      if (result.success) {

        const importedCount = Object.values(result.imported ?? {}).reduce((sum, n) => sum + n, 0);

        setStatusMessage({
          type: "success",
          text: `${t("settingsDatabase.importCompletePrefix")} ${importedCount} ${t("settingsDatabase.importCompleteSuffix")}`
        });

        await loadInfo();

      }
      else if (!result.cancelled) {

        setStatusMessage({ type: "error", text: result.error ?? t("settingsDatabase.importFailed") });

      }

    }
    finally {

      setIsImportingData(false);

    }

  }

  async function loadInfo() {

    setIsLoadingInfo(true);

    try {

      const data = await window.mooral.database.getInfo();
      setInfo(data);

    }
    catch (error) {

      console.error("Failed to load database info:", error);

    }
    finally {

      setIsLoadingInfo(false);

    }

  }

  useEffect(() => {

    loadInfo();

  }, []);

  async function handleBackup() {

    setStatusMessage(null);
    setIsBackingUp(true);

    try {

      const result = await window.mooral.database.backup();

      if (result.cancelled) {
        return;
      }

      if (result.success) {

        setStatusMessage({
          type: "success",
          text: `${t("settingsDatabase.backupCreatedAt")} ${result.filePath}.`
        });

      }
      else {

        setStatusMessage({
          type: "error",
          text: result.error || t("settingsDatabase.backupFailed")
        });

      }

    }
    catch (error) {

      console.error("Backup failed:", error);

      setStatusMessage({
        type: "error",
        text: t("settingsDatabase.backupFailedDetail")
      });

    }
    finally {

      setIsBackingUp(false);

    }

  }

  async function handleRestore() {

    const confirmed = window.confirm(t("settingsDatabase.restoreConfirm"));

    if (!confirmed) {
      return;
    }

    setStatusMessage(null);
    setIsRestoring(true);

    try {

      const result = await window.mooral.database.restore();

      if (result.cancelled) {
        return;
      }

      if (result.success) {

        setStatusMessage({
          type: "success",
          text: t("settingsDatabase.restoreSuccess")
        });

        // The app will call app.relaunch() + app.exit() shortly on the
        // main-process side. Lock every action on this page for good
        // (rather than letting the `finally` block below re-enable
        // them) so nothing else can be triggered in that brief window
        // before the process actually quits.
        setIsAppRestarting(true);

      }
      else {

        setStatusMessage({
          type: "error",
          text: result.error || t("settingsDatabase.restoreFailed")
        });

      }

    }
    catch (error) {

      console.error("Restore failed:", error);

      setStatusMessage({
        type: "error",
        text: t("settingsDatabase.restoreFailedDetail")
      });

    }
    finally {

      setIsRestoring(false);

    }

  }

  async function handleVacuum() {

    setStatusMessage(null);
    setIsVacuuming(true);

    try {

      const result = await window.mooral.database.vacuum();

      if (result.success) {

        setStatusMessage({
          type: "success",
          text: t("settingsDatabase.optimizeSuccess")
        });

        loadInfo();

      }
      else {

        setStatusMessage({
          type: "error",
          text: result.error || t("settingsDatabase.optimizeFailed")
        });

      }

    }
    catch (error) {

      console.error("Vacuum failed:", error);

      setStatusMessage({
        type: "error",
        text: t("settingsDatabase.optimizeFailedDetail")
      });

    }
    finally {

      setIsVacuuming(false);

    }

  }

  async function handleCheckIntegrity() {

    setStatusMessage(null);
    setIsCheckingIntegrity(true);

    try {

      const result = await window.mooral.database.checkIntegrity();

      if (result.success && result.ok) {

        setStatusMessage({
          type: "success",
          text: t("settingsDatabase.integritySuccess")
        });

      }
      else {

        setStatusMessage({
          type: "error",
          text: result.error || `${t("settingsDatabase.integrityIssuePrefix")} ${result.detail}`
        });

      }

    }
    catch (error) {

      console.error("Integrity check failed:", error);

      setStatusMessage({
        type: "error",
        text: t("settingsDatabase.integrityFailedDetail")
      });

    }
    finally {

      setIsCheckingIntegrity(false);

    }

  }

  return (
    <SettingsShell
      title={t("settingsDatabase.title")}
      description={t("settingsDatabase.description")}
    >

      {!isOwner && (
        <p className="settings-section-description">
          {t("settingsDatabase.ownerOnlyNote")}
        </p>
      )}

      <div className="settings-section">

        <h3>{t("settingsDatabase.overviewTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsDatabase.overviewDescription")}
        </p>

        {isLoadingInfo ? (
          <p>{t("settingsCommon.loading")}</p>
        ) : (
          <>
            <div className="db-info-grid">

              <div className="db-info-card">
                <div className="db-info-card-label">{t("settingsDatabase.fileLocation")}</div>
                <div className="db-info-card-value">{info?.path ?? "-"}</div>
              </div>

              <div className="db-info-card">
                <div className="db-info-card-label">{t("settingsDatabase.fileSize")}</div>
                <div className="db-info-card-value">{formatBytes(info?.sizeBytes ?? 0)}</div>
              </div>

              <div className="db-info-card">
                <div className="db-info-card-label">{t("settingsDatabase.lastModified")}</div>
                <div className="db-info-card-value">{formatDateTime(info?.lastModified)}</div>
              </div>

              <div className="db-info-card">
                <div className="db-info-card-label">{t("settingsDatabase.totalRecords")}</div>
                <div className="db-info-card-value">
                  {info
                    ? Object.values(info.tableCounts).reduce((sum, count) => sum + count, 0)
                    : 0}
                </div>
              </div>

            </div>

            {info && (
              <div className="db-table-counts">
                {Object.entries(info.tableCounts).map(([table, count]) => (
                  <span key={table} className="db-table-count-chip">
                    {tableLabel(table)}: {count}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

      </div>

      {isOwner && (
      <>

      <div className="settings-section">

        <h3><Download size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsDatabase.backupTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsDatabase.backupDescription")}
        </p>

        <button
          className="db-action-button"
          onClick={handleBackup}
          disabled={isBusy}
        >
          {isBackingUp ? t("settingsDatabase.creatingBackup") : t("settingsDatabase.backupNow")}
        </button>

      </div>

      <div className="settings-section">

        <h3><Upload size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsDatabase.restoreTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsDatabase.restoreDescription")}
        </p>

        <button
          className="db-action-button danger"
          onClick={handleRestore}
          disabled={isBusy}
        >
          {isRestoring ? t("settingsDatabase.restoring") : t("settingsDatabase.restoreFromBackup")}
        </button>

      </div>

      <div className="settings-section">

        <h3><Wrench size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsDatabase.toolsTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsDatabase.toolsDescription")}
        </p>

        <div className="settings-actions">

          <button
            className="db-action-button secondary"
            onClick={handleVacuum}
            disabled={isBusy}
          >
            <RefreshCw size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {isVacuuming ? t("settingsDatabase.optimizing") : t("settingsDatabase.optimizeDatabase")}
          </button>

          <button
            className="db-action-button secondary"
            onClick={handleCheckIntegrity}
            disabled={isBusy}
          >
            <HardDrive size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {isCheckingIntegrity ? t("settingsDatabase.checking") : t("settingsDatabase.checkIntegrity")}
          </button>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsDatabase.importExportTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsDatabase.importExportDescription")}
        </p>

        <div className="settings-actions">

          <button
            className="db-action-button secondary"
            onClick={handleExportData}
            disabled={isBusy}
          >
            <Download size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {isExportingData ? t("settingsDatabase.exporting") : t("settingsDatabase.exportData")}
          </button>

          <button
            className="db-action-button secondary"
            onClick={handleImportData}
            disabled={isBusy}
          >
            <Upload size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {isImportingData ? t("settingsDatabase.importing") : t("settingsDatabase.importData")}
          </button>

        </div>

      </div>

      <ErpResetPanel />

      </>
      )}

      {statusMessage && (
        statusMessage.type === "success" ? (
          <div className="settings-save-confirmation" role="status" aria-live="polite">
            <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {statusMessage.text}
          </div>
        ) : (
          <div className="settings-error-message" role="alert" aria-live="assertive">
            <AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {statusMessage.text}
          </div>
        )
      )}

    </SettingsShell>
  );

}
