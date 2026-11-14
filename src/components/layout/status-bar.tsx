import { Database, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

/**
 * Graphite Atelier application status bar.
 *
 * Every value here is read from the real application, never mocked:
 *   - database state from `window.mooral.database.getInfo()` (the same IPC
 *     the Database settings page uses),
 *   - the signed-in identity from the auth context,
 *   - the version from Electron's `app.getVersion()`,
 *   - connectivity from the browser's own `navigator.onLine` plus the
 *     online/offline window events.
 *
 * It is deliberately read-only: no new IPC surface, no writes, and a failure
 * to read the database is shown as "Unavailable" rather than throwing, so a
 * status-bar problem can never take down a page.
 */

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);

  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export default function StatusBar(): JSX.Element {

  const { t } = useLanguage();
  const { user } = useAuth();

  // `database:getInfo` is owner/administrator-only in the main process (it is
  // one of the handlers gated by requireUserType). Calling it for an Employee
  // would reject and paint a false red "Unavailable" dot, so the indicator is
  // simply not shown to roles that are not allowed to read it.
  const canReadDatabaseInfo =
    user?.user_type === "owner" || user?.user_type === "administrator";

  const [dbState, setDbState] = useState<"loading" | "connected" | "unavailable">("loading");
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    let isMounted = true;

    if (!canReadDatabaseInfo) {
      return () => {
        isMounted = false;
      };
    }

    window.mooral.database.getInfo()
      .then((info) => {
        if (!isMounted) return;
        setDbState("connected");
        setDbSize(info.sizeBytes);
      })
      .catch((error) => {
        if (!isMounted) return;
        console.error("Status bar database check failed:", error);
        setDbState("unavailable");
      });

    window.mooral.app.getInfo()
      .then((info) => {
        if (isMounted) setAppVersion(info.appVersion);
      })
      .catch(() => {
        // Version is decoration; leave it blank rather than guessing.
      });

    return () => {
      isMounted = false;
    };
  }, [canReadDatabaseInfo]);

  useEffect(() => {
    function goOnline() { setIsOnline(true); }
    function goOffline() { setIsOnline(false); }

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const identity = user?.full_name?.trim() || user?.username || "";

  return (
    <footer className="statusbar" role="status" aria-live="polite">

      <div className="statusbar-group">

        {canReadDatabaseInfo && (
          <span className="statusbar-item">
            <span
              className={
                dbState === "connected"
                  ? "ga-dot ga-dot--online"
                  : dbState === "unavailable"
                    ? "ga-dot ga-dot--offline"
                    : "ga-dot ga-dot--pending"
              }
              aria-hidden="true"
            />
            {t("shell.database")}
            <span className="statusbar-value">
              {dbState === "connected"
                ? t("shell.connected")
                : dbState === "unavailable"
                  ? t("shell.unavailable")
                  : t("shell.ready")}
            </span>
          </span>
        )}

        {dbSize !== null && (
          <span className="statusbar-item statusbar-item--muted">
            <Database size={12} aria-hidden="true" />
            {formatBytes(dbSize)}
          </span>
        )}

      </div>

      <div className="statusbar-group">

        <span className="statusbar-item">
          {isOnline
            ? <Wifi size={12} aria-hidden="true" />
            : <WifiOff size={12} aria-hidden="true" />}
          {isOnline ? t("shell.online") : t("shell.offline")}
        </span>

        {identity && (
          <span className="statusbar-item statusbar-item--muted" title={t("shell.signedInAs")}>
            {t("shell.signedInAs")} {identity}
          </span>
        )}

        {appVersion && (
          <span className="statusbar-item statusbar-item--muted">v{appVersion}</span>
        )}

      </div>

    </footer>
  );
}
