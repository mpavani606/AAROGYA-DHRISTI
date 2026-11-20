import { useTranslation } from "react-i18next";

export function SimulationBanner() {
  const { t } = useTranslation();
  return <div className="simulation-banner fixed inset-x-0 top-0 z-50 bg-medical-900 px-4 py-2 text-center text-sm font-bold text-white" role="status">{t("simulation")}</div>;
}
