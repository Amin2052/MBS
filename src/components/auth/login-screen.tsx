import { useEffect, useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import mooralLogo from "@/assets/mooral-logo.png";

import ForgotPasswordScreen from "./forgot-password-screen";

import ForgotUsernameScreen from "./forgot-username-screen";

import "./login-screen.css";

const GOOGLE_FONTS_LINK_ID = "mbs-login-google-fonts";

/**
 * Loads the approved Sora/Inter web fonts for the login screen only.
 * This is best-effort: if the app is offline the <link> simply fails
 * to load and the CSS fallback font stack ('Sora', 'Inter', system-ui)
 * is used instead, so login is never blocked by network access.
 */
function useLoginFonts(): void {
  useEffect(() => {
    if (document.getElementById(GOOGLE_FONTS_LINK_ID)) {
      return;
    }

    const preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";

    const preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "anonymous";

    const stylesheet = document.createElement("link");
    stylesheet.id = GOOGLE_FONTS_LINK_ID;
    stylesheet.rel = "stylesheet";
    stylesheet.href =
      "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap";

    document.head.appendChild(preconnect1);
    document.head.appendChild(preconnect2);
    document.head.appendChild(stylesheet);
  }, []);
}

export default function LoginScreen(): JSX.Element {

  const { login } = useAuth();
  const { t } = useLanguage();

  useLoginFonts();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showForgotUsername, setShowForgotUsername] = useState(false);

  if (showForgotPassword) {
    return <ForgotPasswordScreen onBack={() => setShowForgotPassword(false)} />;
  }

  if (showForgotUsername) {
    return <ForgotUsernameScreen onBack={() => setShowForgotUsername(false)} />;
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (!username.trim() || !password) {
      setError(t("login.missingCredentials"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const result = await login(username.trim(), password, rememberMe);

      if (!result.success) {
        setError(result.error ?? t("login.loginFailed"));
      }

    }
    catch {

      setError(t("login.loginFailed"));

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

          <div className="mbs-feature-list">

            <div className="mbs-feature">
              <div className="mbs-dot">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="mbs-feature-text">
                <div className="mbs-t">{t("login.featureReportingTitle")}</div>
                <div className="mbs-d">{t("login.featureReportingDesc")}</div>
              </div>
            </div>

            <div className="mbs-feature">
              <div className="mbs-dot">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M3 7h18M3 12h18M3 17h10" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </div>
              <div className="mbs-feature-text">
                <div className="mbs-t">{t("login.featureInventoryTitle")}</div>
                <div className="mbs-d">{t("login.featureInventoryDesc")}</div>
              </div>
            </div>

            <div className="mbs-feature">
              <div className="mbs-dot">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="3.2" strokeWidth="1.6" />
                  <path d="M5 20c1.4-3.6 4-5.4 7-5.4s5.6 1.8 7 5.4" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </div>
              <div className="mbs-feature-text">
                <div className="mbs-t">{t("login.featureAccessTitle")}</div>
                <div className="mbs-d">{t("login.featureAccessDesc")}</div>
              </div>
            </div>

          </div>

          <div className="mbs-trust-strip">
            <span>{t("login.trustBusinessReady")}</span><span className="mbs-sep" /><span>{t("login.trustRoleBasedSecurity")}</span><span className="mbs-sep" /><span>{t("login.trustAuditReady")}</span>
          </div>

        </div>

        <div className="mbs-card-side">
          <div className="mbs-card">

            <div className="mbs-card-title">{t("login.welcomeBack")}</div>
            <div className="mbs-card-desc">{t("login.signInSubtitle")}</div>

            <form onSubmit={handleSubmit}>

              <div className="mbs-field-group">
                <label htmlFor="login-username" className="mbs-field-label">{t("login.usernameLabel")}</label>
                <input
                  id="login-username"
                  className="mbs-field-input"
                  type="text"
                  placeholder={t("login.usernamePlaceholder")}
                  autoComplete="username"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  disabled={submitting}
                  autoFocus
                />
              </div>

              <div className="mbs-field-group">
                <label htmlFor="login-password" className="mbs-field-label">{t("login.passwordLabel")}</label>
                <div className="mbs-field-input-row">
                  <input
                    id="login-password"
                    className="mbs-field-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    autoComplete="current-password"
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

              <div className="mbs-row-between">
                <label className="mbs-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={event => setRememberMe(event.target.checked)}
                    disabled={submitting}
                  />
                  {t("login.rememberMe")}
                </label>
                <div className="mbs-forgot-stack">
                  <button
                    type="button"
                    className="mbs-forgot"
                    onClick={() => setShowForgotUsername(true)}
                  >
                    {t("login.forgotUsername")}
                  </button>
                  <button
                    type="button"
                    className="mbs-forgot"
                    onClick={() => setShowForgotPassword(true)}
                  >
                    {t("login.forgotPassword")}
                  </button>
                </div>
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
                {submitting ? t("login.signingIn") : t("login.signIn")}
              </button>

            </form>

            <div className="mbs-security-indicator">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth="1.6" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeWidth="1.6" />
              </svg>
              {t("login.secureAuthentication")}
            </div>

          </div>
        </div>

      </div>

    </div>
  );

}
