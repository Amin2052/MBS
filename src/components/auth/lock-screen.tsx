import { useState } from "react";

import { Lock, Eye, EyeOff, ArrowRight } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import "./auth-shared.css";

// ===================================================================
// Lock Screen
//
// Shown by AuthGate in place of the app when useIdleLock() reports
// the configured Session Timeout has elapsed with no activity (see
// Settings > Security > Session Timeout & Automatic Lock). The
// session itself is never ended -- this only blocks the UI until the
// current user's password is re-entered, exactly like a normal OS
// lock screen. Re-uses the ordinary login() call (same username,
// freshly entered password) as the unlock check, rather than a
// separate IPC endpoint, since verifying a password is exactly what
// login() already does.
// ===================================================================

export default function LockScreen({ onUnlock }: { onUnlock: () => void }): JSX.Element {

  const { user, login, logout } = useAuth();
  const { t } = useLanguage();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {

    event.preventDefault();

    if (!user) return;

    setSubmitting(true);
    setError(null);

    try {

      const result = await login(user.username, password, false);

      if (result.success) {
        setPassword("");
        onUnlock();
      } else {
        setError(result.error ?? t("lockScreen.incorrectPassword"));
      }

    }
    catch {

      setError(t("lockScreen.incorrectPassword"));

    }
    finally {

      setSubmitting(false);

    }

  }

  return (
    <div className="auth-screen">
      <div className="auth-card">

        <div className="auth-header">

          <Lock size={28} className="auth-icon" />

          <div>
            <h1 className="auth-title">{t("lockScreen.title")}</h1>
            <p className="auth-subtitle">
              {user?.username} — {t("lockScreen.subtitlePrompt")}
            </p>
          </div>

        </div>

        <form onSubmit={handleSubmit}>

          <div className="auth-field">

            <label htmlFor="lock-password" className="auth-field-label">
              {t("login.passwordLabel")}
            </label>

            <div className="auth-input-row">
              <Lock size={16} className="auth-input-icon" />
              <input
                id="lock-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={submitting}
                autoFocus
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

          {error ? (
            <p className="auth-message auth-message-error">
              {error}
            </p>
          ) : null}

          <button type="submit" className="auth-button" disabled={submitting || !password}>
            {submitting ? t("lockScreen.unlocking") : t("lockScreen.unlock")}
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
