import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, Flame } from "lucide-react";

import { resetErp, factoryReset } from "@/services/owner-control-service";
import { useLanguage } from "@/hooks/use-language";

// ===================================================================
// ERP Reset / Factory Reset Panel
//
// Implements the spec's exact ERP Reset workflow (also reused for
// Factory Reset -- same countdown mechanism, different backing call):
// warning -> Cancel/Continue -> 15s countdown (Reset disabled, Cancel
// live) -> Cancel stops immediately and returns to the warning page ->
// countdown reaching zero enables the Reset button -> the Owner must
// still manually click it -> progress -> app relaunches. No extra
// native confirmation dialog; this flow *is* the confirmation.
// ===================================================================

type ResetKind = "erp" | "factory";
type Stage = "idle" | "confirm" | "countdown" | "ready" | "resetting";

const COUNTDOWN_SECONDS = 15;

function panelCopy(kind: ResetKind, t: (key: string) => string) {

  if (kind === "factory") {
    return {
      title: t("erpReset.factoryReset"),
      warning: t("erpReset.factoryResetWarning"),
      confirmLabel: t("erpReset.factoryReset")
    };
  }

  return {
    title: t("erpReset.resetErp"),
    warning: t("erpReset.erpResetWarning"),
    confirmLabel: t("erpReset.resetErp")
  };

}

export default function ErpResetPanel(): JSX.Element {

  const { t } = useLanguage();
  const [activeKind, setActiveKind] = useState<ResetKind | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);

  useEffect(() => {

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
    };

  }, []);

  function openConfirm(kind: ResetKind): void {

    setActiveKind(kind);
    setStage("confirm");
    setError(null);

  }

  function startCountdown(): void {

    setStage("countdown");
    setSecondsLeft(COUNTDOWN_SECONDS);

    intervalRef.current = window.setInterval(() => {

      setSecondsLeft(prev => {

        if (prev <= 1) {

          if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
          }

          setStage("ready");

          return 0;

        }

        return prev - 1;

      });

    }, 1000);

  }

  function cancelAll(): void {

    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setActiveKind(null);
    setStage("idle");
    setSecondsLeft(COUNTDOWN_SECONDS);

  }

  async function performReset(): Promise<void> {

    if (!activeKind) {
      return;
    }

    setStage("resetting");
    setError(null);

    try {

      const result = activeKind === "erp" ? await resetErp() : await factoryReset();

      if (!result.success) {

        setError(result.error ?? t("erpReset.resetFailed"));
        setStage("ready");

      }

      // On success, the main process relaunches the app on its own
      // (same pattern as Restore From Backup) -- nothing further to
      // do here.

    }
    catch (resetError) {

      setError(resetError instanceof Error ? resetError.message : t("erpReset.resetFailed"));
      setStage("ready");

    }

  }

  const copy = activeKind ? panelCopy(activeKind, t) : null;

  return (
    <div className="settings-section">

      <h3><AlertTriangle size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} /> {t("erpReset.sectionTitle")}</h3>

      <p className="settings-section-description">
        {t("erpReset.sectionDescription")}
      </p>

      {stage === "idle" && (

        <div className="settings-actions">

          <button className="db-action-button danger" onClick={() => openConfirm("erp")}>
            <RotateCcw size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {t("erpReset.resetErp")}
          </button>

          <button className="db-action-button danger" onClick={() => openConfirm("factory")}>
            <Flame size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {t("erpReset.factoryReset")}
          </button>

        </div>

      )}

      {stage !== "idle" && copy && (

        <div>

          <div className="settings-error-message" role="alert" aria-live="assertive" style={{ marginBottom: 12 }}>
            <AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {copy.warning}
          </div>

          {stage === "confirm" && (

            <div className="settings-actions">
              <button className="db-action-button secondary" onClick={cancelAll}>{t("common.cancel")}</button>
              <button className="db-action-button danger" onClick={startCountdown}>{t("erpReset.continue")}</button>
            </div>

          )}

          {stage === "countdown" && (

            <div className="settings-actions">

              <button className="db-action-button secondary" onClick={cancelAll}>{t("common.cancel")}</button>

              <button className="db-action-button danger" disabled>
                {copy.confirmLabel} ({secondsLeft}s)
              </button>

            </div>

          )}

          {stage === "ready" && (

            <div className="settings-actions">
              <button className="db-action-button secondary" onClick={cancelAll}>{t("common.cancel")}</button>
              <button className="db-action-button danger" onClick={performReset}>{copy.confirmLabel}</button>
            </div>

          )}

          {stage === "resetting" && (
            <p className="settings-section-description">{t("erpReset.resetting")}</p>
          )}

        </div>

      )}

      {error && (
        <div className="settings-error-message" role="alert" aria-live="assertive" style={{ marginTop: 12 }}>
          <AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          {error}
        </div>
      )}

    </div>
  );

}
