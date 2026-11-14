import { useEffect, useState } from "react";

function downloadLicenseFile(code: string, content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${code}.mbslicense`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GenerateLicense(): JSX.Element {
  const [customerName, setCustomerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [licenseType, setLicenseType] = useState("standard");
  const [businessMode, setBusinessMode] = useState<"starter" | "enterprise">("starter");
  const [expirationDate, setExpirationDate] = useState("");
  const [machineFingerprint, setMachineFingerprint] = useState("");
  const [notes, setNotes] = useState("");

  // Signing-key environment. Surfaced prominently here (not just on the
  // Dashboard) because THIS is the screen where an operator can
  // accidentally hand a customer a license MBS will permanently reject:
  // a packaged/installed MBS build only trusts licenses signed with a
  // "production" key (see trusted-keys.ts's environment-gated
  // findTrustedKey() on the MBS side) -- a "development" key (produced
  // whenever this Generator itself is run via `npm run dev`, or built
  // without MBS_GENERATOR_ENV=production) will always be rejected there,
  // with no way to tell from the activation code or license file alone.
  const [keyInfo, setKeyInfo] = useState<{ keyId: string; environment: "development" | "production" } | null>(null);

  useEffect(() => {
    window.generator.keys.info().then(setKeyInfo).catch(() => setKeyInfo(null));
    window.generator.settings.cloud.get().then((saved) => {
      setCloudEnabled(saved.enabled);
      setCloudMode(saved.mode);
      setCloudApiUrl(saved.apiUrl);
      setCloudWorkspaceId(saved.workspaceId);
      setCloudApiKey(saved.apiKey);
    }).catch(() => {
      // Settings are optional; generation can still proceed with empty values.
    });
  }, []);

  const isDevKey = keyInfo?.environment === "development";


  // Cloud/API entitlement (optional). Mirrors MBS's licensedCloudConfig
  // contract: "developer_managed" carries real connection details entered
  // here; "customer_managed" only grants the entitlement, and MBS sources
  // the actual apiUrl/workspaceId/apiKey from the customer's own local
  // configuration instead — those fields are ignored/blanked for that mode.
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudMode, setCloudMode] = useState<"developer_managed" | "customer_managed">("developer_managed");
  const [cloudApiUrl, setCloudApiUrl] = useState("");
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState("");
  const [cloudApiKey, setCloudApiKey] = useState("");

  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // AUDIT/UX FIX: the vault-backed settings:cloud:get/save IPC already
  // existed (see vault-manager.ts) and this page already loaded saved
  // values on mount (above), but nothing ever called .save() -- so
  // anything typed into this section was lost the moment the app was
  // closed. Wired up an explicit Save button below; it round-trips
  // through the same encrypted vault storage the license-generation
  // fields never touch, so the API key never sits in a plaintext file.
  const [cloudSettingsSaved, setCloudSettingsSaved] = useState(false);
  const [cloudSettingsError, setCloudSettingsError] = useState<string | null>(null);
  const [savingCloudSettings, setSavingCloudSettings] = useState(false);

  async function handleSaveCloudSettings() {
    setSavingCloudSettings(true);
    setCloudSettingsError(null);
    setCloudSettingsSaved(false);
    try {
      await window.generator.settings.cloud.save({
        enabled: cloudEnabled,
        mode: cloudMode,
        apiUrl: cloudApiUrl.trim(),
        workspaceId: cloudWorkspaceId.trim(),
        apiKey: cloudApiKey
      });
      setCloudSettingsSaved(true);
    } catch (e: any) {
      setCloudSettingsError(e?.message ?? "Could not save cloud settings.");
    } finally {
      setSavingCloudSettings(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setResult(null);
    if (!customerName || !companyName || !machineFingerprint) {
      setError("Customer name, company name, and machine ID are required.");
      return;
    }
    if (isDevKey) {
      const proceed = window.confirm(
        "This Generator instance is signing with a DEVELOPMENT key " +
        `(${keyInfo?.keyId ?? "dev"}). A license signed with a development ` +
        "key will be permanently rejected by any packaged/installed MBS " +
        "build -- it only works with `npm run dev`. Do NOT send this to a " +
        "real customer. Continue anyway (for local testing only)?"
      );
      if (!proceed) return;
    }
    try {
      const res = await window.generator.license.generate({
        customerName, companyName, licenseType,
        expirationDate: expirationDate || null,
        machineFingerprint: machineFingerprint.trim(),
        businessMode,
        notes,
        // Omit entirely rather than sending a disabled/empty object when the
        // operator never touched this section, so a license with no cloud
        // entitlement at all matches MBS's "field absent" meaning exactly.
        ...(cloudEnabled || cloudApiUrl || cloudWorkspaceId || cloudApiKey
          ? {
              licensedCloudConfig: {
                enabled: cloudEnabled,
                mode: cloudMode,
                apiUrl: cloudApiUrl.trim(),
                workspaceId: cloudWorkspaceId.trim(),
                apiKey: cloudApiKey
              }
            }
          : {})
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate license.");
    }
  }

  return (
    <div className="gen-page">
      <h1>Generate License</h1>
      {keyInfo && isDevKey && (
        // Only shown when actually dangerous (signing with a dev key,
        // which any packaged MBS build will reject). Nothing is shown
        // at all in the normal/production case, per request.
        <div className="gen-env-banner gen-env-banner-dev">
          {`⚠ Signing with DEVELOPMENT key (${keyInfo.keyId}) -- licenses generated now will be REJECTED by any installed/packaged MBS build. Run the Generator with "npm run dev:prod" (or "npm run dist:win") to sign real customer licenses.`}
        </div>
      )}
      <div className="gen-form">
        <label>Customer Name
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
        </label>
        <label>Company Name
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" />
        </label>
        <label>License Type
          <select value={licenseType} onChange={(e) => setLicenseType(e.target.value)}>
            <option value="trial">Trial</option><option value="standard">Standard</option>
            <option value="professional">Professional</option><option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label>Business Mode
          <select value={businessMode} onChange={(e) => setBusinessMode(e.target.value as "starter" | "enterprise")}>
            <option value="starter">Starter</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label>Expiration Date
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
        </label>
        <label>Machine ID
          <input value={machineFingerprint} onChange={(e) => setMachineFingerprint(e.target.value)} placeholder="Paste customer's Machine ID" />
        </label>
        <label>Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional internal notes" />
        </label>

        <fieldset className="gen-fieldset">
          <legend>Cloud / API Entitlement</legend>
          <label className="gen-checkbox-label">
            <input type="checkbox" checked={cloudEnabled} onChange={(e) => { setCloudEnabled(e.target.checked); setCloudSettingsSaved(false); }} />
            Grant cloud entitlement
          </label>
          <label>Configuration mode
            <select value={cloudMode} onChange={(e) => { setCloudMode(e.target.value as "developer_managed" | "customer_managed"); setCloudSettingsSaved(false); }}>
              <option value="developer_managed">Developer-managed (enter connection details below)</option>
              <option value="customer_managed">Customer-managed (customer enters their own server)</option>
            </select>
          </label>
          {cloudMode === "developer_managed" ? (
            <>
              <label>API URL
                <input value={cloudApiUrl} onChange={(e) => { setCloudApiUrl(e.target.value); setCloudSettingsSaved(false); }} placeholder="https://cloud.example.com" />
              </label>
              <label>Workspace ID
                <input value={cloudWorkspaceId} onChange={(e) => { setCloudWorkspaceId(e.target.value); setCloudSettingsSaved(false); }} placeholder="company-001" />
              </label>
              <label>API Key
                <input value={cloudApiKey} onChange={(e) => { setCloudApiKey(e.target.value); setCloudSettingsSaved(false); }} placeholder="Gateway API key" />
              </label>
              <div className="gen-settings-note">
                These values are embedded in the signed license and applied by MBS internally — the API key is
                never shown to the customer inside the app.
              </div>
            </>
          ) : (
            <div className="gen-settings-note">
              The license only grants permission to connect a server. The customer enters and stores their own
              server details locally in MBS; no connection details are embedded in this license.
            </div>
          )}

          <div className="gen-cloud-settings-actions">
            <button type="button" onClick={handleSaveCloudSettings} disabled={savingCloudSettings}>
              {savingCloudSettings ? "Saving…" : "Save These Values"}
            </button>
            {cloudSettingsSaved && <span className="gen-settings-saved-note">✓ Saved — will be here next time you open the app.</span>}
            {cloudSettingsError && <span className="gen-error">{cloudSettingsError}</span>}
          </div>
          <div className="gen-settings-note">
            Saving here only remembers these values for next time you open this form (encrypted in the vault) —
            it does not itself generate or change any license. Still need to press "Generate &amp; Sign License"
            below for each customer.
          </div>
        </fieldset>

        {error && <div className="gen-error">{error}</div>}
        <button onClick={handleGenerate}>Generate &amp; Sign License</button>
      </div>

      {result && (
        <div className="gen-result">
          <h3>Activation Code</h3>
          <div className="gen-activation-code">{result.activationCode}</div>
          <div>
            <button onClick={() => navigator.clipboard.writeText(result.activationCode)}>Copy Code</button>
            <button onClick={() => downloadLicenseFile(result.activationCode, result.licenseFile)}>Export License File</button>
          </div>
          <div className="gen-key-info">
            Give the customer the activation code and the encrypted license file.
            Both are required for offline activation.
          </div>
          <div className="gen-detail-item"><strong>Business Mode:</strong> {result.signed?.payload?.businessMode ?? businessMode}</div>
          <div className="gen-detail-item"><strong>Signed with:</strong> {result.signed?.payload?.keyId ?? keyInfo?.keyId} ({isDevKey ? "development" : "production"})</div>
        </div>
      )}
    </div>
  );
}
