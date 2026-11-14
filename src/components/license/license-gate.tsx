import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PropsWithChildren
} from "react";
import { useLicense } from "@/hooks/use-license";
import mooralLogo from "@/assets/mooral-logo.png";
import "@/components/auth/login-screen.css";
import "./license-gate.css";

const normalize = (v: string) =>
  v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

type Profile = {
  ownerFullName: string;
  companyName: string;
  email: string;
  phone: string;
  machineId?: string;
  requestId?: string;
};

export default function LicenseGate({ children }: PropsWithChildren): JSX.Element {
  const { status, loading, activateCompact } = useLicense();
  const [parts, setParts] = useState(["", "", "", "", ""]);
  const [licenseFile, setLicenseFile] = useState<string | null>(null);
  const [licenseFileName, setLicenseFileName] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [trialOpen, setTrialOpen] = useState(false);
  const [editOnly, setEditOnly] = useState(false);
  const [trialForm, setTrialForm] = useState({
    ownerFullName: "",
    companyName: "",
    email: "",
    phone: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    (async () => {
      try {
        const saved = await window.mooral.license.getTrialProfile();
        if (saved) {
          setProfile(saved);
          setTrialForm({
            ownerFullName: saved.ownerFullName,
            companyName: saved.companyName,
            email: saved.email,
            phone: saved.phone
          });
        }
      } catch {
        // Profile is optional; activation remains available.
      }
    })();
  }, []);

  if (loading) return <div className="mbs-login mbs-license-loading">Loading…</div>;
  if (status?.activated) return <>{children}</>;

  const code = parts.join("");

  function setPart(i: number, value: string) {
    const clean = normalize(value).slice(0, 4);
    const next = [...parts];
    next[i] = clean;
    setParts(next);
    if (clean.length === 4 && i < 4) refs.current[i + 1]?.focus();
  }

  function paste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const clean = normalize(e.clipboardData.getData("text"));
    setParts(Array.from({ length: 5 }, (_, i) => clean.slice(i * 4, i * 4 + 4)));
  }

  function keyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !parts[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  async function browseLicenseFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mbslicense";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (!text.trim()) throw new Error("The selected license file is empty.");
        if (text.length > 500_000) throw new Error("The selected license file is too large.");
        setLicenseFile(text);
        setLicenseFileName(file.name);
        setError(null);
        setNotice("License file loaded.");
      } catch (e: any) {
        setLicenseFile(null);
        setLicenseFileName(null);
        setError(e?.message ?? "Could not read the license file.");
      }
    };
    input.click();
  }

  async function activate() {
    if (code.length !== 20) {
      setError("Enter the complete 20-character activation code.");
      return;
    }
    if (!licenseFile) {
      setError("Select the license file supplied with the activation code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await activateCompact(code, licenseFile);
      if (!result.activated) setError(result.reason ?? "Activation failed.");
    } catch (e: any) {
      setError(e?.message ?? "Activation failed.");
    } finally {
      setBusy(false);
    }
  }

  function openTrial() {
    setEditOnly(false);
    setError(null);
    setNotice(null);
    setTrialOpen(true);
  }

  function editSavedDetails() {
    setEditOnly(true);
    setError(null);
    setNotice(null);
    setTrialOpen(true);
  }

  async function saveEditedDetails() {
    setBusy(true);
    setError(null);
    try {
      const saved = await window.mooral.license.saveTrialProfile(trialForm);
      setProfile(saved);
      setTrialOpen(false);
      setNotice("Activation details updated.");
    } catch (e: any) {
      setError(e?.message ?? "Could not save activation details.");
    } finally {
      setBusy(false);
    }
  }

  function updateTrialField(key: keyof typeof trialForm, value: string) {
    setTrialForm((current) => ({ ...current, [key]: value }));
  }

  async function activateTrial() {
    const { ownerFullName, companyName, email, phone } = trialForm;
    if (!ownerFullName.trim() || !companyName.trim() || !email.trim() || !phone.trim()) {
      setError("Full name, company name, personal email, and phone number are compulsory.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await window.mooral.license.saveTrialProfile(trialForm);
      setProfile(saved);
      const result = await window.mooral.license.activateTrial(trialForm);
      if (!result.success) {
        setError(result.reason ?? "Trial activation failed.");
        return;
      }
      setTrialOpen(false);
      setNotice("Your 7-day trial has been activated.");
      setError(null);
      window.location.reload();
    } catch (e: any) {
      setError(e?.message ?? "Trial activation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function whatsapp() {
    try {
      await window.mooral.license.requestViaWhatsApp();
    } catch (e: any) {
      setError(e?.message ?? "Could not open WhatsApp.");
    }
  }

  async function email() {
    try {
      await window.mooral.license.requestViaEmail();
    } catch (e: any) {
      setError(e?.message ?? "Could not open email.");
    }
  }

  return (
    <div className="mbs-login">

      <div className="mbs-field" />

      <div className="mbs-geo mbs-g1">
        <svg viewBox="0 0 220 220" fill="none">
          <polygon points="110,10 210,60 210,160 110,210 10,160 10,60" stroke="url(#mbs-gg1-lic)" strokeWidth="1.2" />
          <polygon points="110,50 170,80 170,140 110,170 50,140 50,80" stroke="url(#mbs-gg1-lic)" strokeWidth="1" />
          <defs>
            <linearGradient id="mbs-gg1-lic" x1="0" y1="0" x2="220" y2="220">
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
              <img src={mooralLogo} alt="Mooral Business Suite logo" />
            </div>
            <div className="mbs-logo-word">MOORAL <span>Business Suite</span></div>
          </div>

          <h1 className="mbs-headline">
            Activate your<br /><span className="mbs-accent">workspace.</span>
          </h1>
          <p className="mbs-subhead">
            Enter the activation code and license file you received, or start a free 7-day trial to explore the full suite.
          </p>

          <div className="mbs-feature-list">

            <div className="mbs-feature">
              <div className="mbs-dot">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth="1.6" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeWidth="1.6" />
                </svg>
              </div>
              <div className="mbs-feature-text">
                <div className="mbs-t">Secure, offline activation</div>
                <div className="mbs-d">Your license is verified and bound to this device only.</div>
              </div>
            </div>

            <div className="mbs-feature">
              <div className="mbs-dot">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="mbs-feature-text">
                <div className="mbs-t">Full ERP, unlocked</div>
                <div className="mbs-d">Accounting, inventory, HR and reporting — all in one place.</div>
              </div>
            </div>

          </div>

          <div className="mbs-trust-strip">
            <span>Business Ready</span><span className="mbs-sep" /><span>Role-Based Security</span><span className="mbs-sep" /><span>Audit Ready</span>
          </div>

        </div>

        <div className="mbs-card-side">
          <div className="mbs-card mbs-license-card">

            <div className="mbs-card-title">Activation Wizard</div>
            <div className="mbs-card-desc">Activate with a license code, or start a free trial.</div>

            <label className="mbs-field-label">Activation Code</label>
            <div className="mbs-license-code-row">
              {parts.map((v, i) => (
                <input
                  key={i}
                  ref={(el) => { refs.current[i] = el; }}
                  className="mbs-field-input mbs-license-code-input"
                  value={v}
                  maxLength={4}
                  inputMode="text"
                  onChange={(e) => setPart(i, e.target.value)}
                  onKeyDown={(e) => keyDown(i, e)}
                  onPaste={paste}
                  aria-label={`Activation code group ${i + 1}`}
                />
              ))}
            </div>

            <label className="mbs-field-label mbs-license-label-spaced">License File</label>
            <div className="mbs-license-package">
              <button type="button" className="mbs-btn-secondary mbs-license-browse" onClick={browseLicenseFile}>
                Browse
              </button>
              <span className={licenseFileName ? "mbs-license-file-loaded" : "mbs-license-file-empty"}>
                {licenseFileName ?? "Select .mbslicense file"}
              </span>
            </div>

            {notice && <div className="mbs-message-success">{notice}</div>}
            {error && <p className="mbs-message-error">{error}</p>}

            <button
              type="button"
              className="mbs-btn-login mbs-license-activate"
              disabled={busy || code.length !== 20 || !licenseFile}
              onClick={activate}
            >
              {busy ? "Activating…" : "Activate License"}
            </button>

            <div className="mbs-license-request-actions">
              <button type="button" className="mbs-license-trial-action" onClick={openTrial}>
                Activate Trial
              </button>
              <button type="button" className="mbs-license-secondary-action" onClick={whatsapp}>Request via WhatsApp</button>
              <button type="button" className="mbs-license-secondary-action" onClick={email}>Request via Email</button>
            </div>
            {profile && (
              <button type="button" className="mbs-license-edit-profile" onClick={editSavedDetails}>
                Edit saved details
              </button>
            )}

            <div className="mbs-security-indicator">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth="1.6" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeWidth="1.6" />
              </svg>
              Secure Activation
            </div>

          </div>
        </div>

      </div>

      {trialOpen && (
        <div className="mbs-license-modal-backdrop" role="dialog" aria-modal="true">
          <div className="mbs-license-modal">
            <div className="mbs-license-modal-head">
              <div>
                <span className="mbs-license-eyebrow">Free Trial</span>
                <h2>{editOnly ? "Edit Activation Details" : "Activate 7-Day Trial"}</h2>
                <p>{editOnly ? "These saved details are used automatically in future activation requests." : "This device is automatically registered with your trial."}</p>
              </div>
              <button type="button" className="mbs-license-modal-close" onClick={() => setTrialOpen(false)}>×</button>
            </div>

            <div className="mbs-license-trial-form">
              <label>Owner Full Name *
                <input className="mbs-field-input" value={trialForm.ownerFullName} onChange={(e) => updateTrialField("ownerFullName", e.target.value)} autoFocus />
              </label>
              <label>Company Name *
                <input className="mbs-field-input" value={trialForm.companyName} onChange={(e) => updateTrialField("companyName", e.target.value)} />
              </label>
              <label>Personal Email *
                <input className="mbs-field-input" type="email" value={trialForm.email} onChange={(e) => updateTrialField("email", e.target.value)} />
              </label>
              <label>Phone Number *
                <input className="mbs-field-input" type="tel" value={trialForm.phone} onChange={(e) => updateTrialField("phone", e.target.value)} />
              </label>
            </div>

            {profile?.requestId && (
              <div className="mbs-license-trial-request-id">
                Request ID: <strong>{profile.requestId}</strong>
              </div>
            )}

            <div className="mbs-license-modal-actions">
              <button type="button" className="mbs-btn-secondary" disabled={busy} onClick={() => setTrialOpen(false)}>
                Discard
              </button>
              <button
                type="button"
                className="mbs-btn-login"
                disabled={busy}
                onClick={editOnly ? saveEditedDetails : activateTrial}
              >
                {busy ? (editOnly ? "Saving…" : "Activating…") : (editOnly ? "Save Changes" : "Activate 7-Day Trial")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
