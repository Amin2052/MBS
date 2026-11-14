import { useEffect, useState } from "react";

import { DEFAULT_COMPANY_SETTINGS } from "@/constants/company-settings";

import type { CompanySettings } from "@/types/company-settings";
import { useLanguage } from "@/hooks/use-language";

import SettingsShell from "./settings-shell";

export default function HrPayrollSettingsPage(): JSX.Element {

  const { t } = useLanguage();
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);

  async function loadSettings() {

    setIsLoading(true);

    try {

      const data = await window.mooral.settings.get();

      setSettings({
        ...DEFAULT_COMPANY_SETTINGS,
        ...data
      });

    }
    catch (error) {

      console.error("Failed to load HR & payroll settings:", error);

    }
    finally {

      setIsLoading(false);

    }

  }

  useEffect(() => {

    loadSettings();

  }, []);

  function updateField<K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) {

    setSettings(prev => ({ ...prev, [key]: value }));
    setSavedMessage(false);

  }

  async function handleSave() {

    setIsSaving(true);

    try {

      await window.mooral.settings.save(settings);
      setSavedMessage(true);

    }
    catch (error) {

      console.error("Failed to save HR & payroll settings", error);

    }
    finally {

      setIsSaving(false);

    }

  }

  if (isLoading) {

    return (
      <SettingsShell title={t("settingsHrPayroll.title")} description={t("settingsHrPayroll.description")}>
        <p>{t("settingsCommon.loading")}</p>
      </SettingsShell>
    );

  }

  return (
    <SettingsShell
      title={t("settingsHrPayroll.title")}
      description={t("settingsHrPayroll.description")}
    >

      <div className="settings-section">

        <h3>{t("settingsHrPayroll.employeeSettingsTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsHrPayroll.defaultProbationPeriod")}</label>
            <input
              type="number"
              min="0"
              value={settings.employeeProbationDays}
              onChange={(e) => updateField("employeeProbationDays", e.target.value === "" ? 0 : Number(e.target.value))}
              placeholder="90"
            />
          </div>

        </div>

      </div>

      <div className="settings-section">

        <h3>{t("settingsHrPayroll.payrollSettingsTitle")}</h3>

        <div className="form-grid">

          <div className="form-group">
            <label>{t("settingsHrPayroll.salaryCycle")}</label>
            <select
              value={settings.payrollSalaryCycle}
              onChange={(e) => updateField("payrollSalaryCycle", e.target.value as CompanySettings["payrollSalaryCycle"])}
            >
              <option value="Monthly">{t("settingsHrPayroll.monthly")}</option>
              <option value="Bi-Weekly">{t("settingsHrPayroll.biWeekly")}</option>
              <option value="Weekly">{t("settingsHrPayroll.weekly")}</option>
            </select>
          </div>

          <div className="form-group">
            <label>{t("settingsHrPayroll.payday")}</label>
            <input
              type="number"
              min="1"
              max="31"
              value={settings.payrollPayDay}
              onChange={(e) => updateField("payrollPayDay", e.target.value === "" ? 1 : Number(e.target.value))}
              placeholder="1"
            />
          </div>

          <div className="form-group">
            <label>{t("settingsHrPayroll.overtimeRateMultiplier")}</label>
            <input
              type="number"
              min="1"
              step="0.1"
              value={settings.payrollOvertimeRate}
              onChange={(e) => updateField("payrollOvertimeRate", e.target.value === "" ? 1 : Number(e.target.value))}
              placeholder="1.5"
            />
          </div>

        </div>

      </div>

      <div className="settings-actions">

        <button className="save-settings" onClick={handleSave} disabled={isSaving}>
          {isSaving ? t("settingsCommon.saving") : t("settingsCommon.saveChanges")}
        </button>

        <button className="reset-settings" onClick={loadSettings} disabled={isSaving}>
          {t("settingsCommon.discardChanges")}
        </button>

      </div>

      {savedMessage && (
        <div className="settings-save-confirmation">{t("settingsHrPayroll.savedConfirmation")}</div>
      )}

    </SettingsShell>
  );

}
