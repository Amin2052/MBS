import { useEffect, useState } from "react";
import AuthGate from "./components/AuthGate";
import Dashboard from "./pages/Dashboard";
import GenerateLicense from "./pages/GenerateLicense";
import LicenseList from "./pages/LicenseList";
import SettingsPage from "./pages/SettingsPage";

type Tab = "dashboard" | "generate" | "licenses" | "settings";

export default function App(): JSX.Element {

  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");

  useEffect(() => {
    window.generator.vault.isUnlocked().then(setUnlocked);
  }, []);

  if (!unlocked) {
    return <AuthGate onUnlocked={() => setUnlocked(true)} />;
  }

  return (
    <div className="gen-shell">
      <nav className="gen-nav">
        <div className="gen-brand"><div className="gen-nav-title">MBS License Generator</div><div className="gen-nav-subtitle">Offline licensing authority</div></div>
        <button onClick={() => setTab("dashboard")} className={tab === "dashboard" ? "active" : ""}>Dashboard</button>
        <button onClick={() => setTab("generate")} className={tab === "generate" ? "active" : ""}>Generate License</button>
        <button onClick={() => setTab("licenses")} className={tab === "licenses" ? "active" : ""}>Licenses</button>
        <button onClick={() => setTab("settings")} className={tab === "settings" ? "active" : ""}>Settings</button>
        <button
          className="gen-nav-lock"
          onClick={async () => { await window.generator.vault.lock(); setUnlocked(false); }}
        >
          Lock
        </button>
      </nav>
      <main className="gen-main">
        {tab === "dashboard" && <Dashboard />}
        {tab === "generate" && <GenerateLicense />}
        {tab === "licenses" && <LicenseList />}
        {tab === "settings" && <SettingsPage />}
      </main>
    </div>
  );

}
