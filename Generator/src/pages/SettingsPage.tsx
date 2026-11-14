import { useEffect, useState } from "react";

export default function SettingsPage(): JSX.Element {
  const [keyInfo, setKeyInfo] = useState<any>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    window.generator.keys.info().then(setKeyInfo);
  }, []);

  async function exportRevocation() {
    try {
      const bundle = await window.generator.revocation.exportBundle();
      const blob = new Blob([bundle], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mbs-revocation-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setSettingsError(e?.message ?? "Could not export revocation bundle.");
    }
  }

  async function backupDatabase() {
    setBackupMsg(null);
    try {
      const result = await window.generator.database.backup();
      if (result.canceled) return;
      setBackupMsg(result.success ? `Backup saved to ${result.filePath}` : "Backup failed.");
    } catch (e: any) {
      setBackupMsg(e?.message ?? "Backup failed.");
    }
  }

  function openRestore() {
    setRestoreConfirmText("");
    setRestoreError(null);
    setRestoreMsg(null);
    setRestoreOpen(true);
  }

  async function confirmRestore() {
    if (restoreConfirmText !== "RESTORE") {
      setRestoreError('Type "RESTORE" exactly to confirm.');
      return;
    }
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      const result = await window.generator.database.restore(restoreConfirmText);
      if (result.canceled) {
        setRestoreBusy(false);
        return;
      }
      setRestoreOpen(false);
      setRestoreMsg(`Database restored. ${result.licensesRestored} license record(s) loaded.`);
    } catch (e: any) {
      setRestoreError(e?.message ?? "Restore failed.");
    } finally {
      setRestoreBusy(false);
    }
  }

  function openReset() {
    setResetConfirmText("");
    setResetError(null);
    setResetMsg(null);
    setResetOpen(true);
  }

  async function confirmReset() {
    if (resetConfirmText !== "RESET") {
      setResetError('Type "RESET" exactly to confirm.');
      return;
    }
    setResetBusy(true);
    setResetError(null);
    try {
      const result = await window.generator.database.reset(resetConfirmText);
      setResetOpen(false);
      setResetMsg(`Database reset. ${result.licensesRemoved} license record(s) removed.`);
    } catch (e: any) {
      setResetError(e?.message ?? "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="gen-page">
      <div className="gen-settings-header">
        <div>
          <h1>Settings</h1>
          <p>Manage your signing authority, backups and local data.</p>
        </div>
      </div>

      <div className="gen-settings-grid">
        <section className="gen-settings-card">
          <div className="gen-settings-card-icon">🔑</div>
          <div className="gen-settings-card-head"><div><h3>Signing Key</h3><p>Your private key never leaves the encrypted vault.</p></div></div>
          {keyInfo ? (
            <>
              <div className="gen-detail-item"><strong>Key ID:</strong> {keyInfo.keyId}</div>
              <label className="gen-settings-key-label">Public Key
                <textarea readOnly rows={4} value={keyInfo.publicKeyBase64} />
              </label>
              <div className="gen-settings-inline-note">Add this public key to MBS trusted keys. The private signing key remains protected locally.</div>
            </>
          ) : <div className="gen-empty-small">No signing key found.</div>}
        </section>

        <section className="gen-settings-card">
          <div className="gen-settings-card-icon">↻</div>
          <div className="gen-settings-card-head"><div><h3>Offline Revocation</h3><p>Export the signed list of revoked licenses for offline customers.</p></div></div>
          <button className="gen-settings-btn" onClick={() => { setSettingsError(null); exportRevocation(); }}>Export Revocation Bundle</button>
          {settingsError && <div className="gen-error">{settingsError}</div>}
        </section>

        <section className="gen-settings-card">
          <div className="gen-settings-card-icon">▣</div>
          <div className="gen-settings-card-head"><div><h3>Backup Database</h3><p>Create an encrypted, consistent copy of your license database.</p></div></div>
          <button className="gen-settings-btn" onClick={backupDatabase}>Backup Database</button>
          {backupMsg && <div className="gen-settings-inline-note">{backupMsg}</div>}
        </section>

        <section className="gen-settings-card">
          <div className="gen-settings-card-icon">↥</div>
          <div className="gen-settings-card-head"><div><h3>Restore Database</h3><p>Replace the current license database with a verified backup.</p></div></div>
          <button className="gen-settings-btn" onClick={openRestore}>Restore Database</button>
          {restoreMsg && <div className="gen-settings-inline-note">{restoreMsg}</div>}
        </section>

        <section className="gen-settings-card gen-settings-card-danger">
          <div className="gen-settings-card-icon">!</div>
          <div className="gen-settings-card-head"><div><h3>Reset Database</h3><p>Permanently delete license records and audit history. Your vault and signing key are preserved.</p></div></div>
          <button className="gen-settings-btn gen-settings-btn-danger" onClick={openReset}>Reset Database</button>
          {resetMsg && <div className="gen-settings-inline-note">{resetMsg}</div>}
        </section>
      </div>

      {restoreOpen && (
        <div className="gen-modal-backdrop" role="dialog" aria-modal="true">
          <div className="gen-modal">
            <h3>Restore Database</h3>
            <p className="gen-settings-note">
              This replaces every license record and audit entry currently in the Generator
              with the contents of a backup file you choose next. Type <strong>RESTORE</strong> to
              confirm, then pick the backup (.sqlite) file.
            </p>
            <input
              autoFocus
              value={restoreConfirmText}
              placeholder="Type RESTORE to confirm"
              onChange={(e) => setRestoreConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmRestore()}
            />
            {restoreError && <div className="gen-error">{restoreError}</div>}
            <div className="gen-modal-actions">
              <button type="button" onClick={() => setRestoreOpen(false)} disabled={restoreBusy}>Cancel</button>
              <button
                type="button"
                className="gen-modal-primary"
                onClick={confirmRestore}
                disabled={restoreBusy || restoreConfirmText !== "RESTORE"}
              >
                {restoreBusy ? "Choose file…" : "Restore Database"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetOpen && (
        <div className="gen-modal-backdrop" role="dialog" aria-modal="true">
          <div className="gen-modal">
            <h3>Reset Database</h3>
            <p className="gen-settings-note">
              This permanently deletes all license records and audit history. Type <strong>RESET</strong> to confirm.
            </p>
            <input
              autoFocus
              value={resetConfirmText}
              placeholder="Type RESET to confirm"
              onChange={(e) => setResetConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmReset()}
            />
            {resetError && <div className="gen-error">{resetError}</div>}
            <div className="gen-modal-actions">
              <button type="button" onClick={() => setResetOpen(false)} disabled={resetBusy}>Cancel</button>
              <button
                type="button"
                className="gen-modal-primary"
                onClick={confirmReset}
                disabled={resetBusy || resetConfirmText !== "RESET"}
              >
                {resetBusy ? "Resetting…" : "Reset Database"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
