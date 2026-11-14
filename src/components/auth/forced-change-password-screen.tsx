import { useState } from "react";

import { KeyRound, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import "./auth-shared.css";

// ===================================================================
// Forced Change Password Screen
//
// Spec's "FIRST LOGIN" workflow: if Must Change Password = TRUE, do
// NOT open the Dashboard -- show this instead. After a successful
// change, AuthContext.changePassword() updates `user` with the
// server's fresh must_change_password = false, and AuthGate re-renders
// straight into the app on its own; this screen doesn't navigate
// anywhere itself.
// ===================================================================

export default function ForcedChangePasswordScreen(): JSX.Element {

  const { user, changePassword, logout } = useAuth();
  const { t } = useLanguage();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (newPassword.length < 8) {
      setError(t("changePassword.passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("changePassword.passwordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      const result = await changePassword(currentPassword, newPassword);

      if (!result.success) {
        setError(result.error ?? t("changePassword.changeFailed"));
      }

    }
    catch {

      setError(t("changePassword.changeFailed"));

    }
    finally {

      setSubmitting(false);

    }

  }

  return (
    <div className="auth-screen">
      <div className="auth-card">

        <div className="auth-header">

          <KeyRound size={28} className="auth-icon" />

          <div>
            <h1 className="auth-title">{t("forcedChangePassword.title")}</h1>
            <p className="auth-subtitle">
              {user?.username} — {t("forcedChangePassword.subtitlePrompt")}
            </p>
          </div>

        </div>

        <form onSubmit={handleSubmit}>

          <div className="auth-field">

            <label htmlFor="fcp-current" className="auth-field-label">
              {t("forcedChangePassword.currentTemporaryPasswordLabel")}
            </label>

            <div className="auth-input-row">
              <Lock size={16} className="auth-input-icon" />
              <input
                id="fcp-current"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={currentPassword}
                onChange={event => setCurrentPassword(event.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>

          </div>

          <div className="auth-field">

            <label htmlFor="fcp-new" className="auth-field-label">
              {t("changePassword.newPassword")}
            </label>

            <div className="auth-input-row">
              <Lock size={16} className="auth-input-icon" />
              <input
                id="fcp-new"
                type={showPassword ? "text" : "password"}
                placeholder={t("forcedChangePassword.newPasswordPlaceholder")}
                autoComplete="new-password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-visibility-toggle"
                onClick={() => setShowPassword(prev => !prev)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

          </div>

          <div className="auth-field">

            <label htmlFor="fcp-confirm" className="auth-field-label">
              {t("changePassword.confirmPassword")}
            </label>

            <div className="auth-input-row">
              <Lock size={16} className="auth-input-icon" />
              <input
                id="fcp-confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                disabled={submitting}
              />
            </div>

          </div>

          {error ? (
            <p className="auth-message auth-message-error">
              {error}
            </p>
          ) : null}

          <button type="submit" className="auth-button" disabled={submitting}>
            {submitting ? t("forcedChangePassword.updating") : t("forcedChangePassword.updatePassword")}
            <ArrowRight size={16} />
          </button>

          <p className="auth-footer-note">
            <button
              type="button"
              className="auth-visibility-toggle"
              style={{ textDecoration: "underline" }}
              onClick={() => logout()}
            >
              {t("lockScreen.signOutInstead")}
            </button>
          </p>

        </form>

      </div>
    </div>
  );

}
