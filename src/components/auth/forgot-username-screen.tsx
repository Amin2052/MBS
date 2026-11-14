import { useState } from "react";

import { ArrowLeft, Send, CheckCircle2 } from "lucide-react";

import { requestUsernameRecovery } from "@/services/auth-service";
import { useLanguage } from "@/hooks/use-language";

import mooralLogo from "@/assets/mooral-logo.png";

import "./login-screen.css";

export default function ForgotUsernameScreen({ onBack }: { onBack: () => void }): JSX.Element {

  const { t } = useLanguage();
  const [identityNumber, setIdentityNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (!identityNumber.trim() || !dateOfBirth.trim() || !employeeId.trim()) {
      setError(t("forgotUsername.missingFields"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const result = await requestUsernameRecovery(
        identityNumber.trim(),
        dateOfBirth.trim(),
        employeeId.trim()
      );

      if (result.success) {
        setRequestSent(true);
      }
      else {
        setError(result.error ?? t("forgotUsername.genericError"));
      }

    }
    catch {

      setError(t("forgotUsername.genericError"));

    }
    finally {

      setSubmitting(false);

    }

  }

  return (
    <div className="mbs-login">

      <div className="mbs-field" />

      <div className="mbs-geo mbs-g1">
        <svg viewBox="0 0 220 220" fill="none">
          <polygon points="110,10 210,60 210,160 110,210 10,160 10,60" stroke="url(#mbs-gg1)" strokeWidth="1.2" />
          <polygon points="110,50 170,80 170,140 110,170 50,140 50,80" stroke="url(#mbs-gg1)" strokeWidth="1" />
          <defs>
            <linearGradient id="mbs-gg1" x1="0" y1="0" x2="220" y2="220">
              <stop />
              <stop offset="1" stopOpacity="0.2" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="mbs-geo mbs-g2">
        <svg viewBox="0 0 140 140" fill="none">
          <circle cx="70" cy="70" r="68" stroke="var(--bronze)" strokeWidth="1" />
          <circle cx="70" cy="70" r="42" stroke="var(--bronze)" strokeWidth="1" />
        </svg>
      </div>
      <div className="mbs-geo mbs-g3">
        <svg viewBox="0 0 90 90" fill="none">
          <rect x="5" y="5" width="80" height="80" rx="16" stroke="var(--bronze)" strokeWidth="1" />
        </svg>
      </div>

      <div className="mbs-layout">

        <div className="mbs-brand-side">

          <div className="mbs-logo-row">
            <div className="mbs-logo-mark">
              <img src={mooralLogo} alt={t("login.logoAlt")} />
            </div>
            <div className="mbs-logo-word">MOORAL <span>Business Suite</span></div>
          </div>

          <h1 className="mbs-headline">
            {t("login.headlineLine1")}<br />{t("login.headlineLine2")} <span className="mbs-accent">{t("login.headlineAccent")}</span>
          </h1>
          <p className="mbs-subhead">
            {t("login.subhead")}
          </p>

        </div>

        <div className="mbs-card-side">
          <div className="mbs-card">

            <button type="button" className="mbs-back-link" onClick={onBack}>
              <ArrowLeft size={13} />
              {t("forgotUsername.backToSignIn")}
            </button>

            <div className="mbs-card-title">{t("forgotUsername.title")}</div>

            {requestSent ? (

              <>

                <p className="mbs-message-success">
                  <CheckCircle2 size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
                  {t("forgotUsername.successMessage")}
                </p>

                <button type="button" className="mbs-btn-secondary" onClick={onBack}>
                  <ArrowLeft size={16} />
                  {t("forgotUsername.backToSignIn")}
                </button>

              </>

            ) : (

              <form onSubmit={handleSubmit}>

                <div className="mbs-card-desc">
                  {t("forgotUsername.description")}
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fu-identity-number" className="mbs-field-label">{t("forgotUsername.citizenResidentNumberLabel")}</label>
                  <input
                    id="fu-identity-number"
                    className="mbs-field-input"
                    type="text"
                    dir="ltr"
                    placeholder={t("forgotUsername.citizenResidentNumberPlaceholder")}
                    value={identityNumber}
                    onChange={event => setIdentityNumber(event.target.value)}
                    disabled={submitting}
                    autoFocus
                  />
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fu-dob" className="mbs-field-label">{t("employees.dateOfBirth")}</label>
                  <input
                    id="fu-dob"
                    className="mbs-field-input"
                    type="date"
                    dir="ltr"
                    value={dateOfBirth}
                    onChange={event => setDateOfBirth(event.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fu-employee-id" className="mbs-field-label">{t("employees.employeeNumber")}</label>
                  <input
                    id="fu-employee-id"
                    className="mbs-field-input"
                    type="text"
                    dir="ltr"
                    placeholder={t("forgotUsername.employeeNumberPlaceholder")}
                    value={employeeId}
                    onChange={event => setEmployeeId(event.target.value)}
                    disabled={submitting}
                  />
                </div>

                {error ? <p className="mbs-message-error">{error}</p> : null}

                <button type="submit" className="mbs-btn-login" disabled={submitting}>
                  <Send size={16} />
                  {submitting ? t("forgotUsername.sendingRequest") : t("forgotUsername.sendRequest")}
                </button>

              </form>

            )}

          </div>
        </div>

      </div>

    </div>
  );

}
