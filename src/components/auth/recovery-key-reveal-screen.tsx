import { useState } from "react";

import { ShieldQuestion, Copy, Check, ArrowRight } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";

import "./auth-shared.css";

export default function RecoveryKeyRevealScreen({
  recoveryKey,
  onAcknowledge
}: {
  recoveryKey: string;
  onAcknowledge: () => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {

    await navigator.clipboard.writeText(recoveryKey);

    setCopied(true);

    window.setTimeout(() => setCopied(false), 2000);

  }

  return (
    <div className="auth-screen">
      <div className="auth-card">

        <div className="auth-header">

          <ShieldQuestion size={28} className="auth-icon" />

          <div>
            <h1 className="auth-title">{t("recoveryKeyReveal.title")}</h1>
            <p className="auth-subtitle">Mooral Business Suite</p>
          </div>

        </div>

        <p className="auth-subtitle" style={{ marginBottom: 16 }}>
          {t("recoveryKeyReveal.explanation")}
        </p>

        <div className="auth-field">

          <label className="auth-field-label">{t("recoveryKeyReveal.recoveryKeyLabel")}</label>

          <div className="auth-input-row">
            <input type="text" readOnly value={recoveryKey} />
            <button
              type="button"
              className="auth-visibility-toggle"
              onClick={handleCopy}
              tabIndex={-1}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>

        </div>

        <label className="auth-remember-check" style={{ marginBottom: 20 }}>

          <input
            type="checkbox"
            checked={confirmed}
            onChange={event => setConfirmed(event.target.checked)}
          />

          {t("recoveryKeyReveal.confirmSaved")}

        </label>

        <button
          type="button"
          className="auth-button"
          disabled={!confirmed}
          onClick={onAcknowledge}
        >
          {t("recoveryKeyReveal.continueToDashboard")}
          <ArrowRight size={16} />
        </button>

      </div>
    </div>
  );

}
