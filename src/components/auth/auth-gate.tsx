import type { PropsWithChildren } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useIdleLock } from "@/hooks/use-idle-lock";
import { useLanguage } from "@/hooks/use-language";

import FirstTimeSetupWizard from "./first-time-setup-wizard";
import LoginScreen from "./login-screen";
import ForcedChangePasswordScreen from "./forced-change-password-screen";
import RecoveryKeyRevealScreen from "./recovery-key-reveal-screen";
import LockScreen from "./lock-screen";

import "./auth-shared.css";

// ===================================================================
// Auth Gate
//
// The single place that decides which of Setup Wizard / Login Screen
// / Forced Password Change / Recovery Key Reveal / Lock Screen / the
// actual application is shown. Mirrors LicenseGate: it never
// re-derives the decision itself, only reads AuthContext's
// already-resolved `loading` / `setupRequired` / `user` /
// `pendingRecoveryKey`, plus useIdleLock()'s inactivity state for the
// Lock Screen (Phase 8: Session Timeout / Automatic Lock). Sits
// inside LicenseGate in main.tsx -- a license is validated before
// Owner setup/login is ever reachable.
// ===================================================================

export default function AuthGate({ children }: PropsWithChildren): JSX.Element {

  const { loading, setupRequired, user, pendingRecoveryKey, acknowledgeRecoveryKey } = useAuth();
  const { t } = useLanguage();

  // Only tracked once someone is actually logged into the app proper
  // (not during Setup/Login/Recovery-Key/Forced-Change, which have no
  // "session" to time out yet).
  const idleLockEnabled = !loading && !setupRequired && !!user && !pendingRecoveryKey && !user.must_change_password;
  const { isLocked, unlock } = useIdleLock(idleLockEnabled);

  if (loading) {

    return (
      <div className="auth-screen">
        <p className="auth-loading-text">{t("authGate.checkingSession")}</p>
      </div>
    );

  }

  if (setupRequired) {
    return <FirstTimeSetupWizard />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  // Owner setup just succeeded -- block entry to the app until the
  // Owner has acknowledged saving their Recovery Key (Task 2). Checked
  // ahead of must_change_password since the Owner never has that flag.
  if (pendingRecoveryKey) {
    return <RecoveryKeyRevealScreen recoveryKey={pendingRecoveryKey} onAcknowledge={acknowledgeRecoveryKey} />;
  }

  // Mandatory Password Change (spec: "First Login" workflow). Set
  // true for every Administrator/Employee account created or reset
  // via User Management -- Owner never has this set (they choose
  // their own password during First-Time Setup). Blocks the Dashboard
  // entirely until changed, per spec: "Do NOT open Dashboard."
  if (user.must_change_password) {
    return <ForcedChangePasswordScreen />;
  }

  if (isLocked) {
    return <LockScreen onUnlock={unlock} />;
  }

  return <>{children}</>;

}
