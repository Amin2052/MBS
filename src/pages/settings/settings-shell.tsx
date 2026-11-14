import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";

import "./settings-category.css";

interface SettingsShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export default function SettingsShell({
  title,
  description,
  children
}: SettingsShellProps): JSX.Element {

  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <div className="settings-category-page">

      <button
        type="button"
        className="settings-back-link"
        onClick={() => navigate("/settings")}
      >
        <ArrowLeft size={16} />
        {t("settingsShared.backToSettings")}
      </button>

      <div className="settings-category-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>

      <div className="settings-category-body">
        {children}
      </div>

    </div>
  );

}
