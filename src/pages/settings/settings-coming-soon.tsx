import { Construction } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";

interface SettingsComingSoonProps {
  items: string[];
}

export default function SettingsComingSoon({ items }: SettingsComingSoonProps): JSX.Element {

  const { t } = useLanguage();

  return (
    <div className="settings-coming-soon">

      <Construction size={28} className="settings-coming-soon-icon" />

      <h3>{t("settingsShared.comingSoon")}</h3>

      <p>{t("settingsShared.comingSoonDescription")}</p>

      <ul>
        {items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>

    </div>
  );

}
