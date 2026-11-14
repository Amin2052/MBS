import { useEffect, useState } from "react";
import { useLicense } from "@/hooks/use-license";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function LicenseSettingsPage(): JSX.Element {

  const { t } = useLanguage();
  const { status, refresh, deactivate } = useLicense();
  const [revStatus, setRevStatus] = useState<any>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [support, setSupport] = useState({ whatsappNumber: "", email: "" });

  useEffect(() => {
    window.mooral.license.getRevocationStatus().then(setRevStatus);
    window.mooral.license.getSupportConfig().then(setSupport);
  }, []);

  async function handleImportRevocation() {

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async () => {

      const file = input.files?.[0];
      if (!file) return;

      const text = await file.text();
      const result = await window.mooral.license.importRevocationBundle(text);

      setImportMsg(
        result.accepted
          ? `${t("settingsLicense.imported")} ${result.addedCount ?? 0} ${t("settingsLicense.newRevocations")}`
          : `${t("settingsLicense.rejected")} ${result.reason}`
      );

      setRevStatus(await window.mooral.license.getRevocationStatus());
      await refresh();

    };

    input.click();

  }

  return (
    <SettingsShell
      title={t("settingsLicense.title")}
      description={t("settingsLicense.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsLicense.activationStatusTitle")}</h3>

        <div className="db-info-grid">

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.status")}</div>
            <div className="db-info-card-value">{status?.activated ? t("settingsLicense.activated") : t("settingsLicense.notActivated")}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.licenseId")}</div>
            <div className="db-info-card-value">{status?.licenseId ?? "-"}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.customer")}</div>
            <div className="db-info-card-value">{status?.customerName ?? "-"}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.company")}</div>
            <div className="db-info-card-value">{status?.companyName ?? "-"}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.type")}</div>
            <div className="db-info-card-value">{status?.licenseType ?? "-"}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.expiration")}</div>
            <div className="db-info-card-value">{status?.expirationDate ?? t("settingsLicense.noExpiration")}</div>
          </div>

          {/* Requirement 9: read-only Business Mode display. Value comes
              exclusively from status.businessMode, which license-manager.ts
              derives from resolveBusinessMode() on a freshly-verified
              signed payload — there is no input/select here for the
              customer to change it. */}
          {status?.activated && status?.businessMode && (
            <div className="db-info-card">
              <div className="db-info-card-label">{t("settingsLicense.businessMode")}</div>
              <div className="db-info-card-value">
                {t("settingsLicense.currentMode")}: {status.businessMode === "enterprise" ? t("settingsLicense.businessModeEnterprise") : t("settingsLicense.businessModeStarter")}
                {" — "}{t("settingsLicense.businessModeStatusActive")}
              </div>
            </div>
          )}

        </div>

        {status?.activated && (
          <div className="settings-actions">
            <button className="db-action-button danger" type="button" onClick={() => deactivate()}>
              {t("settingsLicense.deactivateLicense")}
            </button>
          </div>
        )}

      </div>

      <div className="settings-section">

        <h3>{t("settingsLicense.revocationTitle")}</h3>

        <div className="db-info-grid">

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.lastImported")}</div>
            <div className="db-info-card-value">{revStatus?.lastImportedAt ?? t("settingsLicense.never")}</div>
          </div>

          <div className="db-info-card">
            <div className="db-info-card-label">{t("settingsLicense.revokedEntriesKnown")}</div>
            <div className="db-info-card-value">{revStatus?.count ?? 0}</div>
          </div>

        </div>

        <div className="settings-actions">
          <button className="db-action-button secondary" type="button" onClick={handleImportRevocation}>
            {t("settingsLicense.importRevocationFile")}
          </button>
        </div>

        {importMsg && <div className="settings-save-confirmation">{importMsg}</div>}

      </div>

      <div className="settings-section">

        <h3>{t("settingsLicense.supportContactsTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsLicense.supportWhatsapp")}</label>
            <div className="settings-readonly-value">
              {support.whatsappNumber || "—"}
            </div>
          </div>

          <div className="form-group">
            <label>{t("settingsLicense.supportEmail")}</label>
            <div className="settings-readonly-value">
              {support.email || "—"}
            </div>
          </div>

        </div>

      </div>

    </SettingsShell>
  );

}
