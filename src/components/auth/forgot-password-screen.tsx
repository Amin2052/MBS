import { useState } from "react";

import {
  Eye,
  EyeOff,
  ArrowLeft,
  Send,
  CheckCircle2
} from "lucide-react";

import {
  requestPasswordReset,
  redeemPasswordResetCode,
  verifyOwnerRecoveryKey,
  resetOwnerPasswordWithRecoveryKey
} from "@/services/auth-service";

import mooralLogo from "@/assets/mooral-logo.png";
import { useLanguage } from "@/hooks/use-language";

import "./login-screen.css";

type Step = "request" | "redeem" | "requestSent" | "recoveryKey" | "recoverySuccess";

const OWNER_RECOVERY_HINT = "The Owner account cannot be recovered this way. Use your Recovery Key instead.";

export default function ForgotPasswordScreen({ onBack }: { onBack: () => void }): JSX.Element {

  const { t } = useLanguage();
  const [step, setStep] = useState<Step>("request");

  const [identityNumber, setIdentityNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [username, setUsername] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestSubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (!identityNumber.trim() || !dateOfBirth.trim() || !employeeId.trim()) {
      setError(t("forgotUsername.missingFields"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const result = await requestPasswordReset(
        identityNumber.trim(),
        dateOfBirth.trim(),
        employeeId.trim()
      );

      if (result.success) {
        setStep("requestSent");
      }
      else if (result.error === OWNER_RECOVERY_HINT) {
        setStep("recoveryKey");
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

  async function handleRedeemSubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (!username.trim() || !resetCode.trim() || !newPassword) {
      setError(t("forgotPassword.missingAllFields"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("changePassword.passwordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const result = await redeemPasswordResetCode(username.trim(), resetCode.trim(), newPassword);

      if (result.success) {
        setStep("recoverySuccess");
      }
      else {
        setError(result.error ?? t("forgotPassword.invalidOrExpiredCode"));
      }

    }
    catch {

      setError(t("forgotUsername.genericError"));

    }
    finally {

      setSubmitting(false);

    }

  }

  async function handleRecoveryKeySubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (!username.trim() || !recoveryKey.trim() || !newPassword) {
      setError(t("forgotPassword.missingAllFields"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("changePassword.passwordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const verification = await verifyOwnerRecoveryKey(username.trim(), recoveryKey.trim());

      if (!verification.success) {
        setError(verification.error ?? t("forgotPassword.invalidOwnerCredentials"));
        return;
      }

      const result = await resetOwnerPasswordWithRecoveryKey(username.trim(), recoveryKey.trim(), newPassword);

      if (result.success) {
        setNewRecoveryKey(result.recoveryKey ?? null);
        setStep("recoverySuccess");
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
              <stop stopColor="#7aa6ff" />
              <stop offset="1" stopColor="#2f6fed" stopOpacity="0.2" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="mbs-geo mbs-g2">
        <svg viewBox="0 0 140 140" fill="none">
          <circle cx="70" cy="70" r="68" stroke="#7aa6ff" strokeWidth="1" />
          <circle cx="70" cy="70" r="42" stroke="#7aa6ff" strokeWidth="1" />
        </svg>
      </div>
      <div className="mbs-geo mbs-g3">
        <svg viewBox="0 0 90 90" fill="none">
          <rect x="5" y="5" width="80" height="80" rx="16" stroke="#7aa6ff" strokeWidth="1" />
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

            {step !== "requestSent" && step !== "recoverySuccess" ? (
              <button type="button" className="mbs-back-link" onClick={onBack}>
                <ArrowLeft size={13} />
                {t("forgotUsername.backToSignIn")}
              </button>
            ) : null}

            <div className="mbs-card-title">
              {step === "recoveryKey" || (step === "recoverySuccess" && newRecoveryKey)
                ? t("forgotPassword.ownerRecoveryTitle")
                : t("forgotPassword.title")}
            </div>

            {step === "request" ? (

              <form onSubmit={handleRequestSubmit}>

                <div className="mbs-card-desc">
                  {t("forgotPassword.requestDescription")}
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-identity-number" className="mbs-field-label">{t("forgotUsername.citizenResidentNumberLabel")}</label>
                  <input
                    id="fp-identity-number"
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
                  <label htmlFor="fp-dob" className="mbs-field-label">{t("employees.dateOfBirth")}</label>
                  <input
                    id="fp-dob"
                    className="mbs-field-input"
                    type="date"
                    dir="ltr"
                    value={dateOfBirth}
                    onChange={event => setDateOfBirth(event.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-employee-id" className="mbs-field-label">{t("employees.employeeNumber")}</label>
                  <input
                    id="fp-employee-id"
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

                <button
                  type="button"
                  className="mbs-forgot"
                  style={{ marginTop: 14, textAlign: "center", width: "100%" }}
                  onClick={() => { setError(null); setStep("redeem"); }}
                >
                  {t("forgotPassword.alreadyHaveCode")}
                </button>

                {/* PHASE 10 UI AUDIT FIX: the "recoveryKey" step (Owner
                    account recovery via username + Recovery Key) had a
                    fully working form and backend calls
                    (verifyOwnerRecoveryKey / resetOwnerPasswordWithRecoveryKey)
                    but no reachable way in -- the only trigger was
                    `result.error === OWNER_RECOVERY_HINT`, and the
                    backend's identity lookup (findUserByOfflineIdentity)
                    joins on the employees table, which Owner accounts
                    never have a row in, so that branch can never fire.
                    The Owner had no way to recover a forgotten password
                    through the UI at all. This link is a direct,
                    always-reachable entry point into the already-built
                    recoveryKey step. */}
                <button
                  type="button"
                  className="mbs-forgot"
                  style={{ marginTop: 6, textAlign: "center", width: "100%" }}
                  onClick={() => { setError(null); setStep("recoveryKey"); }}
                >
                  {t("forgotPassword.ownerRecoveryPrompt")}
                </button>

              </form>

            ) : step === "requestSent" ? (

              <div>

                <p className="mbs-message-success">
                  <CheckCircle2 size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
                  {t("forgotPassword.requestSentMessage")}
                </p>

                <button type="button" className="mbs-btn-login" onClick={() => { setError(null); setStep("redeem"); }}>
                  {t("forgotPassword.haveResetCode")}
                </button>

                <button
                  type="button"
                  className="mbs-forgot"
                  style={{ marginTop: 14, textAlign: "center", width: "100%" }}
                  onClick={onBack}
                >
                  {t("forgotUsername.backToSignIn")}
                </button>

              </div>

            ) : step === "redeem" ? (

              <form onSubmit={handleRedeemSubmit}>

                <div className="mbs-card-desc">
                  {t("forgotPassword.redeemDescription")}
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-redeem-username" className="mbs-field-label">{t("login.usernameLabel")}</label>
                  <input
                    id="fp-redeem-username"
                    className="mbs-field-input"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                    disabled={submitting}
                    autoFocus
                  />
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-reset-code" className="mbs-field-label">{t("forgotPassword.resetCodeLabel")}</label>
                  <input
                    id="fp-reset-code"
                    className="mbs-field-input"
                    type="text"
                    placeholder={t("forgotPassword.resetCodePlaceholder")}
                    value={resetCode}
                    onChange={event => setResetCode(event.target.value.toUpperCase())}
                    disabled={submitting}
                  />
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-new-password" className="mbs-field-label">{t("changePassword.newPassword")}</label>
                  <div className="mbs-field-input-row">
                    <input
                      id="fp-new-password"
                      className="mbs-field-input"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={event => setNewPassword(event.target.value)}
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="mbs-visibility-toggle"
                      onClick={() => setShowPassword(prev => !prev)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-confirm-password" className="mbs-field-label">{t("changePassword.confirmPassword")}</label>
                  <input
                    id="fp-confirm-password"
                    className="mbs-field-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    disabled={submitting}
                  />
                </div>

                {error ? <p className="mbs-message-error">{error}</p> : null}

                <button type="submit" className="mbs-btn-login" disabled={submitting}>
                  {submitting ? t("forgotPassword.resettingPassword") : t("forgotPassword.resetPassword")}
                </button>

              </form>

            ) : step === "recoveryKey" ? (

              <form onSubmit={handleRecoveryKeySubmit}>

                <p className="mbs-message-error">
                  {t("forgotPassword.ownerRecoveryHint")}
                </p>

                <div className="mbs-field-group">
                  <label htmlFor="fp-owner-username" className="mbs-field-label">{t("forgotPassword.ownerUsernameLabel")}</label>
                  <input
                    id="fp-owner-username"
                    className="mbs-field-input"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                    disabled={submitting}
                    autoFocus
                  />
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-recovery-key" className="mbs-field-label">{t("recoveryKeyReveal.recoveryKeyLabel")}</label>
                  <input
                    id="fp-recovery-key"
                    className="mbs-field-input"
                    type="text"
                    placeholder={t("forgotPassword.recoveryKeyPlaceholder")}
                    value={recoveryKey}
                    onChange={event => setRecoveryKey(event.target.value.toUpperCase())}
                    disabled={submitting}
                  />
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-owner-new-password" className="mbs-field-label">{t("changePassword.newPassword")}</label>
                  <div className="mbs-field-input-row">
                    <input
                      id="fp-owner-new-password"
                      className="mbs-field-input"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={event => setNewPassword(event.target.value)}
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="mbs-visibility-toggle"
                      onClick={() => setShowPassword(prev => !prev)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="mbs-field-group">
                  <label htmlFor="fp-owner-confirm-password" className="mbs-field-label">{t("changePassword.confirmPassword")}</label>
                  <input
                    id="fp-owner-confirm-password"
                    className="mbs-field-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    disabled={submitting}
                  />
                </div>

                {error ? <p className="mbs-message-error">{error}</p> : null}

                <button type="submit" className="mbs-btn-login" disabled={submitting}>
                  {submitting ? t("forgotPassword.resettingPassword") : t("forgotPassword.resetPassword")}
                </button>

              </form>

            ) : (

              <div>

                <p className="mbs-message-success">
                  <CheckCircle2 size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
                  {t("forgotPassword.passwordResetSuccessMessage")}
                </p>

                {newRecoveryKey ? (
                  <>
                    <label className="mbs-field-label">{t("forgotPassword.newRecoveryKeyLabel")}</label>
                    <div className="mbs-field-group">
                      <input className="mbs-field-input" type="text" readOnly value={newRecoveryKey} />
                    </div>
                    <p className="mbs-card-desc" style={{ marginTop: -8 }}>
                      {t("forgotPassword.newRecoveryKeySaveNote")}
                    </p>
                  </>
                ) : null}

                <button type="button" className="mbs-btn-login" onClick={onBack}>
                  <ArrowLeft size={16} />
                  {t("forgotUsername.backToSignIn")}
                </button>

              </div>

            )}

          </div>
        </div>

      </div>

    </div>
  );

}
