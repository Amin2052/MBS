import { useEffect, useState } from "react";

type Mode = "loading" | "setup" | "unlock" | "recover-key" | "recover-newpass" | "recovery-key-display";

export default function AuthGate({ onUnlocked }: { onUnlocked: () => void }): JSX.Element {

  const [mode, setMode] = useState<Mode>("loading");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryDisplay, setRecoveryDisplay] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.generator.vault.isInitialized().then((init: boolean) => {
      setMode(init ? "unlock" : "setup");
    });
  }, []);

  async function handleSetup() {

    setError(null);

    if (password.length < 10) return setError("Password must be at least 10 characters.");
    if (password !== password2) return setError("Passwords do not match.");

    const result = await window.generator.vault.setup(password);
    setRecoveryDisplay(result.recoveryKey);
    setMode("recovery-key-display");

  }

  async function handleUnlock() {

    setError(null);

    try {
      const ok = await window.generator.vault.unlock(password);
      if (!ok) return setError("Incorrect master password.");
      onUnlocked();
    } catch (e: any) {
      // AUDIT FIX #4: the IPC handler throws (rather than returning
      // false) when the vault is temporarily locked out after too many
      // failed attempts, so this needs a try/catch to surface that
      // message instead of a silent unhandled rejection.
      setError(e?.message ?? "Could not unlock the vault.");
    }

  }

  async function handleVerifyRecovery() {

    setError(null);

    try {
      const ok = await window.generator.vault.verifyRecoveryKey(recoveryInput);
      if (!ok) return setError("Recovery key is not valid.");
      setMode("recover-newpass");
    } catch (e: any) {
      setError(e?.message ?? "Could not verify the recovery key.");
    }

  }

  async function handleResetWithRecovery() {

    setError(null);

    if (password.length < 10) return setError("New password must be at least 10 characters.");
    if (password !== password2) return setError("Passwords do not match.");

    try {
      const ok = await window.generator.vault.recover(recoveryInput, password);
      if (!ok) return setError("Recovery failed.");
      onUnlocked();
    } catch (e: any) {
      setError(e?.message ?? "Recovery failed.");
    }

  }

  if (mode === "loading") return <div className="gen-auth-loading">Loading…</div>;

  return (
    <div className="gen-auth">
      <div className="gen-auth-card">

        {mode === "setup" && (
          <>
            <h1>Create Master Password</h1>
            <p>This protects the Generator and its private signing key. This cannot be undone or bypassed except with your recovery key.</p>
            <input type="password" placeholder="Master password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input type="password" placeholder="Confirm password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            {error && <div className="gen-auth-error">{error}</div>}
            <button onClick={handleSetup}>Create Vault</button>
          </>
        )}

        {mode === "recovery-key-display" && (
          <>
            <h1>Save Your Recovery Key</h1>
            <p><strong>This is shown only once.</strong> Store it somewhere secure — it is the only way to regain access if you forget your master password.</p>
            <div className="gen-recovery-key">{recoveryDisplay}</div>
            <button onClick={onUnlocked}>I've saved it — Continue</button>
          </>
        )}

        {mode === "unlock" && (
          <>
            <h1>MBS License Generator</h1>
            <input type="password" placeholder="Master password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUnlock()} />
            {error && <div className="gen-auth-error">{error}</div>}
            <button onClick={handleUnlock}>Unlock</button>
            <button className="gen-auth-link" onClick={() => { setError(null); setMode("recover-key"); }}>Forgot password?</button>
          </>
        )}

        {mode === "recover-key" && (
          <>
            <h1>Recover Access</h1>
            <p>Enter your recovery key.</p>
            <input placeholder="XXXXX-XXXXX-XXXXX-..." value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} />
            {error && <div className="gen-auth-error">{error}</div>}
            <button onClick={handleVerifyRecovery}>Verify</button>
            <button className="gen-auth-link" onClick={() => setMode("unlock")}>Back</button>
          </>
        )}

        {mode === "recover-newpass" && (
          <>
            <h1>Create New Master Password</h1>
            <input type="password" placeholder="New master password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input type="password" placeholder="Confirm password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            {error && <div className="gen-auth-error">{error}</div>}
            <button onClick={handleResetWithRecovery}>Reset Password &amp; Unlock</button>
          </>
        )}

      </div>
    </div>
  );

}
