import { useEffect, useState } from "react";
import { ShieldCheck, Lock, CheckCircle2, AlertTriangle, Monitor, LogOut, Info } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { getSecurityPolicy, setSecurityPolicy } from "@/services/owner-control-service";

import SettingsShell from "./settings-shell";

export default function SecuritySettingsPage(): JSX.Element {

  const { t } = useLanguage();
  const { user, businessMode } = useAuth();

  const isOwner = user?.user_type === "owner";

  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [maxAttempts, setMaxAttempts] = useState(5);
  const [lockoutMinutes, setLockoutMinutes] = useState(15);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(0);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [sessions, setSessions] = useState<ActiveSessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  async function loadSessions(): Promise<void> {

    setSessionsLoading(true);

    try {

      setSessions(await window.mooral.sessions.list());

    }
    catch (error) {

      console.error("Failed to load active sessions:", error);

    }
    finally {

      setSessionsLoading(false);

    }

  }

  async function handleRevokeSession(sessionId: number): Promise<void> {

    try {

      await window.mooral.sessions.revoke(sessionId);
      await loadSessions();

    }
    catch (error) {

      alert(error instanceof Error ? error.message : t("settingsSecurity.endSessionFailed"));

    }

  }

  useEffect(() => {

    loadSessions();

  }, []);

  useEffect(() => {

    getSecurityPolicy().then(loaded => {
      setPolicy(loaded);
      setMaxAttempts(loaded.maxLoginAttempts);
      setLockoutMinutes(loaded.lockoutMinutes);
      setSessionTimeoutMinutes(loaded.sessionTimeoutMinutes);
    });

  }, []);

  async function handleSavePolicy(): Promise<void> {

    setSavingPolicy(true);
    setStatusMessage(null);

    try {

      await setSecurityPolicy({ maxLoginAttempts: maxAttempts, lockoutMinutes, sessionTimeoutMinutes });

      setPolicy({ maxLoginAttempts: maxAttempts, lockoutMinutes, sessionTimeoutMinutes });
      setStatusMessage({ type: "success", text: t("settingsSecurity.policySaved") });

    }
    catch (error) {

      setStatusMessage({ type: "error", text: error instanceof Error ? error.message : t("settingsSecurity.policySaveFailed") });

    }
    finally {

      setSavingPolicy(false);

    }

  }

  if (!isOwner) {

    return (
      <SettingsShell title={t("settingsSecurity.title")} description={t("settingsSecurity.description")}>
        <p className="settings-section-description">{t("settingsSecurity.ownerOnlyView")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell title={t("settingsSecurity.title")} description={t("settingsSecurity.description")}>

      <div className="settings-section">

        <h3><ShieldCheck size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsSecurity.businessModeTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsSecurity.businessModeDescription")}
        </p>

        {/* SECURITY (Phase 5): read-only. Business Mode can only change
            by activating a different signed license (see License &
            Activation settings) -- there is no switch/toggle here for
            the Owner to self-upgrade. */}
        <div className="db-info-card" style={{ maxWidth: 320 }}>
          <div className="db-info-card-label">{t("settingsSecurity.businessModeTitle")}</div>
          <div className="db-info-card-value">
            {businessMode === "enterprise" ? t("settingsSecurity.enterpriseMode") : t("settingsSecurity.starterMode")} — {t("settingsSecurity.active")}
          </div>
        </div>

      </div>

      <div className="settings-section">

        <h3><Lock size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsSecurity.lockoutPolicyTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsSecurity.lockoutPolicyDescription")}
        </p>

        <div className="db-info-grid" style={{ marginBottom: 16 }}>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsSecurity.failedAttemptsBeforeLockout")}</div>
            <input
              type="number"
              min={3}
              max={20}
              value={maxAttempts}
              onChange={event => setMaxAttempts(Number(event.target.value))}
              className="db-info-card-input"
            />
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsSecurity.lockoutDuration")}</div>
            <input
              type="number"
              min={1}
              max={1440}
              value={lockoutMinutes}
              onChange={event => setLockoutMinutes(Number(event.target.value))}
              className="db-info-card-input"
            />
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3><ShieldCheck size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsSecurity.sessionTimeoutTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsSecurity.sessionTimeoutDescription")}
        </p>

        <div className="db-info-grid" style={{ marginBottom: 16 }}>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsSecurity.autoLockAfter")}</div>
            <input
              type="number"
              min={0}
              max={480}
              value={sessionTimeoutMinutes}
              onChange={event => setSessionTimeoutMinutes(Number(event.target.value))}
              className="db-info-card-input"
            />
          </div>

        </div>

        <button
          className="db-action-button"
          onClick={handleSavePolicy}
          disabled={savingPolicy || !policy}
        >
          {savingPolicy ? t("settingsSecurity.savingEllipsis") : t("settingsSecurity.savePolicy")}
        </button>

      </div>

      <div className="settings-section">

        <h3><Monitor size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsSecurity.activeSessionsTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsSecurity.activeSessionsDescription")}
        </p>

        {sessionsLoading ? (
          <p>{t("settingsSecurity.loading")}</p>
        ) : sessions.length === 0 ? (
          <p className="settings-section-description">{t("settingsSecurity.noActiveSessions")}</p>
        ) : (
          <div className="db-info-grid" style={{ marginBottom: 16 }}>

            {sessions.map(session => (
              <div className="db-info-card" key={session.id}>

                <div className="db-info-card-label">
                  {session.username}
                  {session.user_id === user?.id ? ` ${t("settingsSecurity.you")}` : ""}
                </div>

                <div className="db-info-card-value" style={{ fontSize: 13, fontWeight: 400 }}>
                  {session.user_type} · {session.remember_me ? t("settingsSecurity.rememberMe") : t("settingsSecurity.standard")}
                  <br />
                  {t("settingsSecurity.lastActive")} {new Date(session.last_used_at).toLocaleString()}
                </div>

                {session.user_id !== user?.id && (
                  <button
                    className="db-action-button danger"
                    style={{ marginTop: 10 }}
                    onClick={() => handleRevokeSession(session.id)}
                  >
                    <LogOut size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {t("settingsSecurity.endSession")}
                  </button>
                )}

              </div>
            ))}

          </div>
        )}

      </div>

      <div className="settings-section">

        <h3><Info size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("settingsSecurity.twoFactorTitle")}</h3>
        <p className="settings-section-description">
          {t("settingsSecurity.twoFactorEvaluation")}
        </p>

      </div>

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
