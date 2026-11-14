import { useEffect, useState } from "react";

export default function Dashboard(): JSX.Element {
  const [counts, setCounts] = useState<any>(null);
  const [keyInfo, setKeyInfo] = useState<any>(null);

  useEffect(() => {
    window.generator.dashboard.counts().then(setCounts);
    window.generator.keys.info().then(setKeyInfo);
  }, []);

  return (
    <div className="gen-page">
      <h1>Dashboard</h1>
      <div className="gen-cards">
        <div className="gen-card"><div className="gen-card-num">{counts?.total ?? "…"}</div><div className="gen-card-label">Total Licenses</div></div>
        <div className="gen-card"><div className="gen-card-num">{counts?.active ?? "…"}</div><div className="gen-card-label">Active</div></div>
        <div className="gen-card"><div className="gen-card-num">{counts?.expired ?? "…"}</div><div className="gen-card-label">Expired</div></div>
        <div className="gen-card"><div className="gen-card-num">{counts?.revoked ?? "…"}</div><div className="gen-card-label">Revoked</div></div>
      </div>
      {/*
        Only rendered when signing with a development key -- that's
        the one state actually worth interrupting the operator for
        (a license signed now would be silently rejected by every
        installed MBS build). Nothing is shown in the normal/
        production case, per request -- key details are still
        reachable any time via keys.info() if ever needed for a
        rotation, just not surfaced here.
      */}
      {keyInfo && keyInfo.environment !== "production" && (
        <div className="gen-env-banner gen-env-banner-dev">
          {`⚠ Development signing key (${keyInfo.keyId}) -- licenses generated now will be REJECTED by any installed/packaged MBS build.`}
        </div>
      )}
    </div>
  );
}
