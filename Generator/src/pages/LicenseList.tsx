import { useEffect, useState } from "react";

export default function LicenseList(): JSX.Element {

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [actionResult, setActionResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Electron does not implement window.prompt() — calling it does not
  // show a dialog and does not reliably return, which silently broke
  // Replace/Renew/Revoke (the code never reached the IPC call). This
  // lightweight in-app modal replaces window.prompt() for those flows.
  const [inputPrompt, setInputPrompt] = useState<{
    title: string;
    placeholder: string;
    value: string;
    resolve: (value: string | null) => void;
  } | null>(null);

  function askInput(title: string, placeholder: string): Promise<string | null> {
    return new Promise((resolve) => {
      setInputPrompt({ title, placeholder, value: "", resolve });
    });
  }

  function submitInputPrompt() {
    if (!inputPrompt) return;
    const { value, resolve } = inputPrompt;
    setInputPrompt(null);
    resolve(value.trim());
  }

  function cancelInputPrompt() {
    if (!inputPrompt) return;
    const { resolve } = inputPrompt;
    setInputPrompt(null);
    resolve(null);
  }

  async function load() {
    const res = query ? await window.generator.license.search(query) : await window.generator.license.list();
    setRows(res);
  }

  useEffect(() => { load(); }, [query]);

  async function openDetails(licenseId: string) {
    const rec = await window.generator.license.get(licenseId);
    setSelected(rec);
    setHistory(await window.generator.license.history(licenseId));
    setActionResult(null);
  }

  async function doReExport() {
    if (!selected || busy) return;
    setError(null); setBusy(true);
    try { setActionResult(await window.generator.license.reExport(selected.licenseId)); }
    catch (e: any) { setError(e?.message ?? "Re-export failed."); }
    finally { setBusy(false); }
  }

  async function doReplace() {
    if (!selected || busy) return;
    const newMachine = await askInput("Create Replacement", "New machine ID (blank = keep same)");
    if (newMachine === null) return;
    setError(null); setBusy(true);
    try {
      const res = await window.generator.license.replace(selected.licenseId, newMachine ? { machineFingerprint: newMachine } : {}, "Replacement issued from Generator UI");
      setActionResult(res);
      await load();
    } catch (e: any) { setError(e?.message ?? "Replacement failed."); }
    finally { setBusy(false); }
  }

  async function doRenew() {
    if (!selected || busy) return;
    const newExp = await askInput("Renew License", "New expiration date YYYY-MM-DD (blank = no expiration)");
    if (newExp === null) return;
    setError(null); setBusy(true);
    try {
      const res = await window.generator.license.renew(selected.licenseId, newExp || null, "Renewed from Generator UI");
      setActionResult(res);
      await load();
    } catch (e: any) { setError(e?.message ?? "Renewal failed."); }
    finally { setBusy(false); }
  }

  async function doRevoke() {
    if (!selected || busy) return;
    if (!confirm("Revoke this license? This cannot be undone.")) return;
    const reason = await askInput("Revoke License", "Revocation reason (optional)");
    if (reason === null) return;
    setError(null); setBusy(true);
    try {
      const result = await window.generator.license.revoke(selected.licenseId, reason || undefined);
      if (!result.success || result.status !== "revoked" || result.license?.status !== "revoked") {
        throw new Error("License was not marked as revoked.");
      }

      // Update the selected details immediately from the authoritative IPC result.
      setSelected(result.license);

      // Refresh both the list and audit history from SQLite.
      await load();
      setHistory(await window.generator.license.history(selected.licenseId));
      setActionResult(null);
    } catch (e: any) { setError(e?.message ?? "Revocation failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="gen-page gen-page-split">
      <div className="gen-list-col">
        <h1>Licenses</h1>
        <input placeholder="Search by license ID, activation code, customer, company, machine…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {error && <div className="gen-error">{error}</div>}
        <div className="gen-table-wrap">
        <table className="gen-table">
          <thead><tr><th>License ID</th><th>Activation Code</th><th>Customer</th><th>Status</th><th>Type</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.licenseId} onClick={() => openDetails(r.licenseId)} className={selected?.licenseId === r.licenseId ? "active" : ""}>
                <td>{r.licenseId}</td>
                <td>{r.data.signedLicense.payload.activationCode ?? "Legacy"}</td>
                <td>{r.data.customerName}</td>
                <td><span className={`gen-status gen-status-${r.status}`}>{r.status.toUpperCase()}</span></td>
                <td>{r.licenseType}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="gen-detail-col">
        {!selected && <div className="gen-empty">Select a license to view details.</div>}
        {selected && (
          <>
            <h2>{selected.licenseId}</h2>
            <div className="gen-detail-grid">
              <div className="gen-detail-item"><strong>Activation Code:</strong> {selected.data.signedLicense.payload.activationCode ?? "Legacy / no compact code"}</div>
              <div className="gen-detail-item"><strong>Customer:</strong> {selected.data.customerName}</div>
              <div className="gen-detail-item"><strong>Company:</strong> {selected.data.companyName}</div>
              <div className="gen-detail-item"><strong>Machine:</strong> {selected.data.machineFingerprint}</div>
              <div className="gen-detail-item"><strong>Status:</strong> <span className={`gen-status gen-status-${selected.status}`}>{selected.status.toUpperCase()}</span></div>
              <div className="gen-detail-item"><strong>Type:</strong> {selected.licenseType}</div>
              <div className="gen-detail-item"><strong>Business Mode:</strong> {selected.data.signedLicense.payload.businessMode ?? "starter (legacy)"}</div>
              <div className="gen-detail-item"><strong>Cloud Entitlement:</strong> {
                selected.data.signedLicense.payload.licensedCloudConfig
                  ? `${selected.data.signedLicense.payload.licensedCloudConfig.enabled ? "Enabled" : "Disabled"} — ${selected.data.signedLicense.payload.licensedCloudConfig.mode ?? "developer_managed"}`
                  : "None"
              }</div>
              <div className="gen-detail-item"><strong>Expiration:</strong> {selected.data.signedLicense.payload.expirationDate ?? "None"}</div>
              <div className="gen-detail-item"><strong>Relationship:</strong> {selected.relationship}{selected.supersedesLicenseId ? ` (supersedes ${selected.supersedesLicenseId})` : ""}</div>
              <div className="gen-detail-item"><strong>Notes:</strong> {selected.data.notes || "—"}</div>
            </div>

            <div className="gen-detail-actions">
              <button onClick={doReExport} disabled={busy}>Re-export Original</button>
              <button onClick={doReplace} disabled={busy}>Create Replacement</button>
              <button onClick={doRenew} disabled={busy}>Renew</button>
              <button onClick={doRevoke} disabled={selected.status === "revoked"}>Revoke</button>
            </div>

            {actionResult && (
              <div className="gen-result">
                <h3>Activation Code</h3>
                <div className="gen-activation-code">{actionResult.activationCode ?? actionResult.licenseKey}</div>
                <button onClick={() => navigator.clipboard.writeText(actionResult.activationCode ?? actionResult.licenseKey)}>Copy</button>
                {actionResult.licenseFile && (
                  <button onClick={() => {
                    const blob = new Blob([actionResult.licenseFile], { type: "application/octet-stream" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${actionResult.activationCode}.mbslicense`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>Export License File</button>
                )}
              </div>
            )}

            <h3>History</h3>
            <ul className="gen-history">
              {history.map((h, i) => (
                <li key={i}>{h.at} — {h.event}{h.detail ? `: ${h.detail}` : ""}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {inputPrompt && (
        <div className="gen-modal-backdrop" role="dialog" aria-modal="true">
          <div className="gen-modal">
            <h3>{inputPrompt.title}</h3>
            <input
              autoFocus
              value={inputPrompt.value}
              placeholder={inputPrompt.placeholder}
              onChange={(e) => setInputPrompt({ ...inputPrompt, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitInputPrompt();
                if (e.key === "Escape") cancelInputPrompt();
              }}
            />
            <div className="gen-modal-actions">
              <button type="button" onClick={cancelInputPrompt}>Cancel</button>
              <button type="button" className="gen-modal-primary" onClick={submitInputPrompt}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

}
