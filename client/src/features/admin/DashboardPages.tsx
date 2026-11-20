import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { getDashboardAsha, getDashboardQuality, getDashboardVillageCoverage, type VillageCoverageRow } from "./dashboardApi";

function PageHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return <><SimulationBanner /><header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pt-24"><div><button type="button" className="mb-4 min-h-touch rounded-lg border px-4" onClick={() => navigate("/admin/dashboard")}>{t("dashboard.back")}</button><h1 className="text-3xl font-bold">{title}</h1></div><LanguageSwitcher /></header></>;
}

export function DashboardDataQuality() {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, number | string | null>>();
  const [error, setError] = useState("");
  useEffect(() => { void getDashboardQuality({}).then(setValues).catch(() => setError(t("dashboard.load_error"))); }, [t]);
  return <><PageHeader title={t("dashboard.data_quality")} /><main className="mx-auto max-w-6xl px-4 pb-12"><section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-800">{error}</p>}
    {!values ? Array.from({ length: 5 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200" />) : [
      ["missingVillage", "missing_village"], ["duplicatePhoneGroups", "duplicate_phone"], ["impossibleAges", "impossible_ages"],
      ["patientsWithRepeatedPoorImages", "repeated_poor_images"], ["pendingSyncTooLong", "pending_sync_quality"]
    ].map(([key, label]) => <article key={key} className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">{t(`dashboard.${label}`)}</h2><p className="mt-2 text-2xl font-bold">{String(values[key] ?? "—")}</p></article>)}
  </section>{values?.pendingSyncNote && <p className="mt-4 text-sm text-slate-600">{values.pendingSyncNote}</p>}</main></>;
}

export function VillageCoverage() {
  const { t } = useTranslation();
  const [villages, setVillages] = useState<VillageCoverageRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void getDashboardVillageCoverage({}).then(setVillages).catch(() => setError(t("dashboard.load_error"))); }, [t]);
  return <><PageHeader title={t("dashboard.village_coverage")} /><main className="mx-auto max-w-6xl px-4 pb-12">
    <p className="mb-4 text-slate-700">{t("dashboard.village_coverage_note")}</p>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-800">{error}</p>}
    {!villages.length ? <div className="animate-pulse rounded-xl bg-slate-200 p-8">{t("loading")}</div> :
      <div className="overflow-auto rounded-2xl bg-white shadow-sm"><table className="w-full text-left"><thead><tr className="border-b"><th className="p-4">{t("dashboard.village")}</th><th className="p-4">{t("dashboard.total_habitations")}</th><th className="p-4">{t("dashboard.screened_habitations")}</th><th className="p-4">{t("dashboard.pending_habitations")}</th><th className="p-4">{t("dashboard.average_coverage")}</th></tr></thead><tbody>{villages.map((village) => <tr key={village.villageId} className="border-b"><td className="p-4 font-semibold">{village.name}</td><td className="p-4">{village.totalHabitations}</td><td className="p-4">{village.screenedHabitations}</td><td className="p-4">{village.pendingHabitations}</td><td className="p-4">{village.averageCoverage}%</td></tr>)}</tbody></table></div>}
  </main></>;
}

export function AshaActivity() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(id);
  const [activity, setActivity] = useState<Record<string, number | string | null>>();
  const [error, setError] = useState("");
  useEffect(() => { if (!id) return; void getDashboardAsha(id, {}).then(setActivity).catch(() => setError(t("dashboard.load_error"))); }, [id, t]);
  return <><PageHeader title={t("dashboard.asha_activity")} /><main className="mx-auto max-w-6xl px-4 pb-12">
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); navigate(`/admin/dashboard/asha/${encodeURIComponent(input)}`); }}>
      <label className="flex-1 text-sm font-semibold">{t("dashboard.asha_id")}<input className="mt-1 min-h-touch w-full rounded-lg border p-3" value={input} onChange={(event) => setInput(event.target.value)} /></label>
      <button className="mt-5 min-h-touch rounded-lg bg-medical-700 px-5 font-bold text-white" type="submit">{t("dashboard.view_activity")}</button>
    </form>
    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-4 text-rose-800">{error}</p>}
    {activity && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["screenings", "screenings"], ["usableImagePercent", "usable_image_rate"], ["pendingSyncs", "pending_syncs"], ["followUpsDue", "follow_ups_due"]].map(([key, label]) => <article key={key} className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">{t(`dashboard.${label}`)}</h2><p className="mt-2 text-2xl font-bold">{activity[key] === null ? "—" : `${activity[key]}${key === "usableImagePercent" && activity[key] !== null ? "%" : ""}`}</p></article>)}</div>}
    {activity?.pendingSyncs === null && <p className="mt-4 text-sm text-slate-600">{t("dashboard.sync_metric_note")}</p>}
  </main></>;
}
