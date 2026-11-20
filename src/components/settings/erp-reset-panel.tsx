import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudOff, Database, Flame, Globe2, Loader2, ShieldCheck } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";
import "./reset-panel.css";

// ===================================================================
// Reset & data panel
//
// Three operations that used to be conflated (the old panel only had ERP
// Reset and Factory Reset, and neither touched the cloud):
//
//   local    -- this computer only
//   cloud    -- the licensed workspace's shared business data
//   complete -- both, plus every account and company settings
//
// Each flow deletes a different set of things, so each one is described
// separately, requires the owner's password again, and requires a typed
// confirmation. The main process enforces both gates too (see main.ts
// reset:local / reset:cloud / reset:complete) -- this UI is the explanation,
// never the security boundary.
// ===================================================================

type ResetKind = "local" | "cloud" | "complete";
type Stage = "idle" | "confirm" | "running";

const KIND_META: Record<ResetKind, { icon: typeof Database; buttonKey: string; titleKey: string; descriptionKey: string; warningKey: string }> = {
  local: {
    icon: Database,
    buttonKey: "erpReset.localButton",
    titleKey: "erpReset.localTitle",
    descriptionKey: "erpReset.localDescription",
    warningKey: "erpReset.localWarning"
  },
  cloud: {
    icon: Globe2,
    buttonKey: "erpReset.cloudButton",
    titleKey: "erpReset.cloudTitle",
    descriptionKey: "erpReset.cloudDescription",
    warningKey: "erpReset.cloudWarning"
  },
  complete: {
    icon: Flame,
    buttonKey: "erpReset.completeButton",
    titleKey: "erpReset.completeTitle",
    descriptionKey: "erpReset.completeDescription",
    warningKey: "erpReset.completeWarning"
  }
};

export default function ErpResetPanel(): JSX.Element {

  const { t } = useLanguage();
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const [kind, setKind] = useState<ResetKind | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ResetOutcome | null>(null);

  const loadPreview = useCallback(async () => {

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      setPreview(await window.mooral.erpControl.preview());
    }
    catch (previewFailure) {
      setPreviewError(previewFailure instanceof Error ? previewFailure.message : t("erpReset.resetFailed"));
    }
    finally {
      setPreviewLoading(false);
    }

  }, [t]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  function openConfirm(next: ResetKind): void {
    setKind(next);
    setStage("confirm");
    setPassword("");
    setPhrase("");
    setError(null);
    setOutcome(null);
  }

  function cancel(): void {
    setKind(null);
    setStage("idle");
    setPassword("");
    setPhrase("");
    setError(null);
  }

  // The expected phrase is deliberately different per operation: the central
  // reset needs the workspace id (impossible to type by muscle memory), the
  // two local wipes need RESET. Enforced again in the main process.
  function expectedPhrase(active: ResetKind): string {
    if (active === "cloud") return preview?.workspaceId ?? "";
    return "RESET";
  }

  function phraseHint(active: ResetKind): string {
    return active === "cloud" ? t("erpReset.phraseCloud") : t("erpReset.phraseComplete");
  }

  async function submit(): Promise<void> {

    if (!kind) return;

    if (!password) {
      setError(t("erpReset.passwordRequired"));
      return;
    }

    if (phrase.trim() !== expectedPhrase(kind)) {
      setError(t("erpReset.phraseMismatch"));
      return;
    }

    setStage("running");
    setError(null);

    try {

      const result = kind === "local"
        ? await window.mooral.erpControl.local({ password })
        : kind === "cloud"
          ? await window.mooral.erpControl.cloud({ password, confirmWorkspace: phrase.trim() })
          : await window.mooral.erpControl.complete({ password, confirmation: phrase.trim() });

      if (!result.success) {
        setError(result.error ?? t("erpReset.resetFailed"));
        setStage("confirm");
        return;
      }

      // Success relays the app on its own (see relaunchAfterReset in main.ts),
      // so this state is only briefly visible; it still reports the backup
      // path first in case the relaunch is slow.
      setOutcome(result as ResetOutcome);
      setStage("running");

    }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : t("erpReset.resetFailed"));
      setStage("confirm");
    }

  }

  const cloudReady = Boolean(preview?.cloudEnabled);
  const activeMeta = kind ? KIND_META[kind] : null;
  const ActiveIcon = activeMeta?.icon ?? Database;

  function renderCounts(): JSX.Element | null {

    if (!preview) return null;

    const rows: Array<[string, number]> = [
      ["products", preview.localCounts.products ?? 0],
      ["customers", preview.localCounts.customers ?? 0],
      ["orders", preview.localCounts.orders ?? 0],
      ["invoices", preview.localCounts.invoices ?? 0]
    ];

    return (
      <ul className="reset-preview-counts">
        {rows.map(([table, count]) => (
          <li key={table}>
            <span>{table}</span>
            <strong>{count}</strong>
          </li>
        ))}
      </ul>
    );

  }

  return (
    <div className="settings-section reset-panel">

      <h3>
        <AlertTriangle size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
        {t("erpReset.sectionTitle")}
      </h3>

      <p className="settings-section-description">{t("erpReset.sectionDescription")}</p>

      <div className="reset-preview" aria-busy={previewLoading}>

        <div className="reset-preview-heading">
          <ShieldCheck size={14} />
          <span>{t("erpReset.previewTitle")}</span>
          {previewLoading && <Loader2 size={14} className="reset-spin" />}
        </div>

        {previewError && <p className="settings-error-message" role="alert">{previewError}</p>}

        {preview && !previewError && (
          <>
            {renderCounts()}
            <p className="reset-preview-line">
              <strong>{t("erpReset.previewCloud")}:</strong>{" "}
              {cloudReady
                ? preview.cloudReachable
                  ? `${preview.workspaceId} · ${t("erpReset.previewEpoch")} ${preview.resetEpoch}`
                  : (
                    <span className="reset-cloud-off">
                      <CloudOff size={13} />{" "}
                      {preview.serverOutdated
                        ? t("erpReset.previewServerOutdated")
                        : t("erpReset.previewUnreachable")}
                    </span>
                  )
                : t("erpReset.cloudUnavailable")}
            </p>
            {/* The exact reason, not just a status word: a 404 here means the
                deployment is older than this app, which the owner can fix. */}
            {cloudReady && !preview.cloudReachable && preview.cloudError && (
              <p className="reset-hint">{preview.cloudError}</p>
            )}
          </>
        )}

      </div>

      {stage === "idle" && (
        <div className="reset-options">

          <div className="reset-option">
            <div className="reset-option-header">
              <Database size={15} />
              <h4>{t("erpReset.localTitle")}</h4>
            </div>
            <p>{t("erpReset.localDescription")}</p>
            <button className="db-action-button danger" onClick={() => openConfirm("local")}>
              {t("erpReset.localButton")}
            </button>
          </div>

          <div className="reset-option">
            <div className="reset-option-header">
              <Globe2 size={15} />
              <h4>{t("erpReset.cloudTitle")}</h4>
            </div>
            <p>{t("erpReset.cloudDescription")}</p>
            <button
              className="db-action-button danger"
              onClick={() => openConfirm("cloud")}
              disabled={!cloudReady}
              title={cloudReady ? undefined : t("erpReset.cloudUnavailable")}
            >
              {t("erpReset.cloudButton")}
            </button>
            {!cloudReady && <p className="reset-hint">{t("erpReset.cloudUnavailable")}</p>}
          </div>

          <div className="reset-option">
            <div className="reset-option-header">
              <Flame size={15} />
              <h4>{t("erpReset.completeTitle")}</h4>
            </div>
            <p>{t("erpReset.completeDescription")}</p>
            <button
              className="db-action-button danger"
              onClick={() => openConfirm("complete")}
            >
              {t("erpReset.completeButton")}
            </button>
          </div>

        </div>
      )}

      {stage !== "idle" && kind && activeMeta && (
        <div className="reset-confirm" role="group" aria-labelledby="reset-confirm-title">

          <div className="settings-error-message" role="alert" aria-live="assertive">
            <ActiveIcon size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {t(activeMeta.warningKey)}
          </div>

          <h4 id="reset-confirm-title">{t(activeMeta.buttonKey)}</h4>

          <p className="reset-backup-note">{t("erpReset.backupNotice")}</p>

          <label className="reset-field">
            <span>{t("erpReset.confirmPassword")}</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              disabled={stage === "running"}
            />
          </label>

          <label className="reset-field">
            <span>{phraseHint(kind)}</span>
            <input
              type="text"
              value={phrase}
              autoComplete="off"
              spellCheck={false}
              placeholder={expectedPhrase(kind)}
              onChange={(event) => setPhrase(event.target.value)}
              disabled={stage === "running"}
            />
          </label>

          {error && (
            <div className="settings-error-message" role="alert" aria-live="assertive">
              <AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {error}
            </div>
          )}

          {outcome?.backupPath && (
            <div className="settings-save-confirmation" role="status">
              {t("erpReset.backupNotice")}<br />
              <code>{outcome.backupPath}</code>
            </div>
          )}

          <div className="settings-actions">
            <button className="db-action-button secondary" onClick={cancel} disabled={stage === "running"}>
              {t("erpReset.cancel")}
            </button>
            <button className="db-action-button danger" onClick={() => void submit()} disabled={stage === "running"}>
              {stage === "running" ? t("erpReset.running") : t(activeMeta.buttonKey)}
            </button>
          </div>

        </div>
      )}

    </div>
  );

}
