import { useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import mooralLogo from "@/assets/mooral-logo.png";

import "./login-screen.css";

export default function FirstTimeSetupWizard(): JSX.Element {

  const { completeSetup } = useAuth();
  const { t } = useLanguage();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (!username.trim() || username.trim().length < 3) {
      setError(t("firstTimeSetup.usernameTooShort"));
      return;
    }

    if (password.length < 8) {
      setError(t("firstTimeSetup.passwordTooShort"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("changePassword.passwordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const result = await completeSetup(username.trim(), password);

      if (!result.success) {
        setError(result.error ?? t("firstTimeSetup.setupFailed"));
      }

    }
    catch {

      setError(t("firstTimeSetup.setupFailed"));

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
          <polygon points="110,10 210,60 210,160 110,210 10,160 10,60" stroke="url(#mbs-gg1-setup)" strokeWidth="1.2" />
          <polygon points="110,50 170,80 170,140 110,170 50,140 50,80" stroke="url(#mbs-gg1-setup)" strokeWidth="1" />
          <defs>
            <linearGradient id="mbs-gg1-setup" x1="0" y1="0" x2="220" y2="220">
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
            {t("firstTimeSetup.headlineLine1")}<br />{t("firstTimeSetup.headlineLine2")} <span className="mbs-accent">{t("firstTimeSetup.headlineAccent")}</span>
          </h1>
          <p className="mbs-subhead">
            {t("firstTimeSetup.subhead")}
          </p>

          <div className="mbs-feature-list">

            <div className="mbs-feature">
              <div className="mbs-dot">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="3.2" strokeWidth="1.6" />
                  <path d="M5 20c1.4-3.6 4-5.4 7-5.4s5.6 1.8 7 5.4" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </div>
              <div className="mbs-feature-text">
                <div className="mbs-t">{t("firstTimeSetup.featureAccessTitle")}</div>
                <div className="mbs-d">{t("firstTimeSetup.featureAccessDesc")}</div>
              </div>
            </div>

            <div className="mbs-feature">
              <div className="mbs-dot">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth="1.6" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeWidth="1.6" />
                </svg>
              </div>
              <div className="mbs-feature-text">
                <div className="mbs-t">{t("firstTimeSetup.featureProtectedTitle")}</div>
                <div className="mbs-d">{t("firstTimeSetup.featureProtectedDesc")}</div>
              </div>
            </div>

          </div>

          <div className="mbs-trust-strip">
            <span>{t("login.trustBusinessReady")}</span><span className="mbs-sep" /><span>{t("login.trustRoleBasedSecurity")}</span><span className="mbs-sep" /><span>{t("login.trustAuditReady")}</span>
          </div>

        </div>

        <div className="mbs-card-side">
          <div className="mbs-card">

            <div className="mbs-card-title">{t("firstTimeSetup.cardTitle")}</div>
            <div className="mbs-card-desc">{t("firstTimeSetup.cardDesc")}</div>

            <form onSubmit={handleSubmit}>

              <div className="mbs-field-group">
                <label htmlFor="setup-username" className="mbs-field-label">{t("firstTimeSetup.usernameLabel")}</label>
                <input
                  id="setup-username"
                  className="mbs-field-input"
                  type="text"
                  placeholder={t("firstTimeSetup.usernamePlaceholder")}
                  autoComplete="username"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  disabled={submitting}
                  autoFocus
                />
              </div>

              <div className="mbs-field-group">
                <label htmlFor="setup-password" className="mbs-field-label">{t("login.passwordLabel")}</label>
                <div className="mbs-field-input-row">
                  <input
                    id="setup-password"
                    className="mbs-field-input"
                    type={showPassword ? "text" : "password"}
                    placeholder={t("forcedChangePassword.newPasswordPlaceholder")}
                    autoComplete="new-password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
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
                <label htmlFor="setup-confirm-password" className="mbs-field-label">{t("changePassword.confirmPassword")}</label>
                <input
                  id="setup-confirm-password"
                  className="mbs-field-input"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("firstTimeSetup.confirmPasswordPlaceholder")}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>

              {error ? (
                <p className="mbs-message-error">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="mbs-btn-login"
                disabled={submitting}
              >
                {submitting ? t("firstTimeSetup.creatingAccount") : t("firstTimeSetup.cardTitle")}
              </button>

              <p className="mbs-footer-note">
                {t("firstTimeSetup.footerNote")}
              </p>

            </form>

            <div className="mbs-security-indicator">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth="1.6" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeWidth="1.6" />
              </svg>
              {t("firstTimeSetup.secureSetup")}
            </div>

          </div>
        </div>

      </div>

    </div>
  );

}
