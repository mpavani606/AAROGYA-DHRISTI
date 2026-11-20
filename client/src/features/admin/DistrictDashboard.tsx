import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { useAuth } from "../auth/AuthProvider";
import { getMandals, type Mandal } from "./adminApi";
import {
  exportDashboard,
  getDashboardAsha,
  getDashboardHotspots,
  getDashboardQuality,
  getDashboardSummary,
  getDashboardVillageCoverage,
  type DashboardFilter,
  type DashboardHotspot,
  type DashboardSummary,
  type VillageCoverageRow
} from "./dashboardApi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const refreshIntervalMs = 30_000;

const qualityMetrics = [
  ["missingVillage", "missing_village"],
  ["duplicatePhoneGroups", "duplicate_phone"],
  ["impossibleAges", "impossible_ages"],
  ["patientsWithRepeatedPoorImages", "repeated_poor_images"],
  ["pendingSyncTooLong", "pending_sync_quality"]
] as const;

const activityMetrics = [
  ["screenings", "screenings"],
  ["usableImagePercent", "usable_image_rate"],
  ["pendingSyncs", "pending_syncs"],
  ["followUpsDue", "follow_ups_due"]
] as const;

export default function DistrictDashboard() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [mandals, setMandals] = useState<Mandal[]>([]);
  const [filters, setFilters] = useState<DashboardFilter>({ mandalId: search.get("mandalId") ?? undefined });
  const [summary, setSummary] = useState<DashboardSummary>();
  const [hotspots, setHotspots] = useState<DashboardHotspot[]>([]);
  const [quality, setQuality] = useState<Record<string, number | string | null>>();
  const [villages, setVillages] = useState<VillageCoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const [ashaId, setAshaId] = useState("");
  const [ashaActivity, setAshaActivity] = useState<Record<string, number | string | null>>();
  const [ashaLoading, setAshaLoading] = useState(false);
  const [ashaError, setAshaError] = useState("");

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const loadMandals = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const rows = await getMandals();
        if (active) setMandals(rows);
      } catch {
        if (active) setError(t("dashboard.load_error"));
      } finally {
        inFlight = false;
      }
    };
    void loadMandals();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMandals();
    }, refreshIntervalMs);
    window.addEventListener("focus", loadMandals);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", loadMandals);
    };
  }, [t]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let initialLoad = true;
    const loadDashboard = async () => {
      if (inFlight) return;
      inFlight = true;
      if (initialLoad) {
        setLoading(true);
        setError("");
        setSummary(undefined);
        setHotspots([]);
        setQuality(undefined);
        setVillages([]);
      }
      try {
        const [nextSummary, nextHotspots, nextQuality, nextVillages] = await Promise.all([
          getDashboardSummary(filters),
          getDashboardHotspots(filters),
          getDashboardQuality(filters),
          getDashboardVillageCoverage(filters)
        ]);
        if (!active) return;
        setSummary(nextSummary);
        setHotspots(nextHotspots);
        setQuality(nextQuality);
        setVillages(nextVillages);
        setUpdatedAt(new Date());
        setError("");
      } catch {
        if (active) setError(t("dashboard.load_error"));
      } finally {
        initialLoad = false;
        inFlight = false;
        if (active) setLoading(false);
      }
    };
    void loadDashboard();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadDashboard();
    }, refreshIntervalMs);
    window.addEventListener("focus", loadDashboard);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", loadDashboard);
    };
  }, [filters, t]);

  const cards = summary ? [
    ["screening_coverage", summary.screeningCoverage, "%"],
    ["usable_image_rate", summary.usableImageRate, "%"],
    ["median_review_hours", summary.medianHoursToReview, "h"],
    ["referral_completion", summary.referralCompletionRate, "%"],
    ["median_diagnosis_days", summary.medianDaysToDiagnosis, "d"],
    ["biopsy_completion", summary.biopsyCompletionRate, "%"],
    ["treatment_linkage", summary.treatmentLinkageRate, "%"],
    ["loss_to_follow_up", summary.lossToFollowUpRate, "%"],
    ["cessation_uptake", summary.cessationUptake, "%"],
    ["notification_success", summary.notificationSuccessRate, "%"]
  ] as const : [];

  const chartData = summary ? [
    { name: t("dashboard.screened"), value: summary.screenedAdults },
    { name: t("dashboard.missed"), value: summary.missedAppointments },
    { name: t("dashboard.eligible"), value: summary.screeningCoverageDenominator }
  ] : [];

  const selectMandal = (mandalId?: string) =>
    setFilters((current) => ({ ...current, mandalId }));

  const loadAshaActivity = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAshaLoading(true);
    setAshaError("");
    setAshaActivity(undefined);
    try {
      setAshaActivity(await getDashboardAsha(ashaId.trim(), filters));
    } catch {
      setAshaError(t("dashboard.load_error"));
    } finally {
      setAshaLoading(false);
    }
  };

  return <>
    <SimulationBanner />
    <main className="mx-auto max-w-7xl px-4 pb-12 pt-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-bold uppercase tracking-wide text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">{t("dashboard.title")}</h1>
          <p className="mt-1 text-slate-600">{t("dashboard.synthetic_notice")}</p>
          <p className="mt-1 text-xs text-slate-500" aria-live="polite">
            Live data refreshes every 30 seconds{updatedAt ? ` · Updated ${updatedAt.toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <LanguageSwitcher />
          <button className="min-h-touch rounded-lg border px-4 font-semibold" type="button" onClick={() => navigate("/admin")}>Hospitals and doctors</button>
          <button className="min-h-touch rounded-lg border px-4" onClick={async () => { await logout(); navigate("/login"); }}>
            {t("logout")}
          </button>
        </div>
      </header>

      <section className="mt-6" aria-label={t("dashboard.all_mandals")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{t("dashboard.all_mandals")}</h2>
          <button
            type="button"
            className={`min-h-touch rounded-lg px-4 font-semibold ${!filters.mandalId ? "bg-medical-700 text-white" : "border bg-white"}`}
            aria-pressed={!filters.mandalId}
            onClick={() => selectMandal(undefined)}
          >
            {t("dashboard.overview")}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mandals.map((mandal) => {
            const selected = filters.mandalId === mandal._id;
            return <button
              key={mandal._id}
              type="button"
              aria-pressed={selected}
              onClick={() => selectMandal(mandal._id)}
              className={`min-h-24 rounded-xl border p-4 text-left transition hover:border-medical-600 focus:outline-none focus:ring-2 focus:ring-medical-600 ${selected ? "border-medical-700 bg-medical-50" : "border-slate-200 bg-white"}`}
            >
              <span className="block font-bold">{mandal.name_en ?? mandal.name}</span>
              {(mandal.name_te ?? mandal.teluguName ?? mandal.name_hi) && <span className="mt-1 block text-sm text-slate-600">{mandal.name_te ?? mandal.teluguName ?? mandal.name_hi}</span>}
              <span className="mt-2 block text-sm text-slate-600">
                {t("dashboard.village")}: {mandal.villageCount ?? "—"} · {t("dashboard.total_habitations")}: {mandal.habitationCount ?? "—"}
              </span>
            </button>;
          })}
        </div>
      </section>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">{t("dashboard.aggregate_only")}</p>
        <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white" onClick={() => void exportDashboard(filters).catch(() => setError(t("dashboard.export_error")))}>
          {t("dashboard.export_csv")}
        </button>
      </div>
      {error && <p className="mt-4 rounded-lg bg-rose-50 p-4 text-rose-800" role="alert">{error}</p>}

      {loading
        ? <div className="mt-6 grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label={t("loading")}>{Array.from({ length: 10 }, (_, index) => <div key={index} className="h-24 rounded-xl bg-slate-200" />)}</div>
        : summary && <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label={t("dashboard.indicators")}>
            {cards.map(([key, value, suffix]) => <article key={key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="min-h-10 text-sm font-semibold text-slate-700">{t(`dashboard.${key}`)}</h2>
              <p className="text-2xl font-bold text-medical-800">{value === null ? "—" : `${value}${suffix}`}</p>
            </article>)}
          </section>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-xl font-bold">{t("dashboard.program_counts")}</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#e8a0b8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-xl font-bold">{t("dashboard.hotspots")}</h2>
              {hotspots.length
                ? <ul className="grid gap-2 sm:grid-cols-2">{hotspots.map((point) => <li key={point.villageId} className="rounded-lg bg-slate-50 p-3">{point.name}: <strong>{point.screened}</strong> {t("dashboard.screenings")}</li>)}</ul>
                : <p className="text-slate-600">—</p>}
              <p className="mt-3 text-sm text-slate-600">{t("dashboard.suppression_note")}</p>
            </section>
          </div>

          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-xl font-bold">{t("dashboard.data_quality")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {qualityMetrics.map(([key, label]) => <article key={key} className="rounded-xl bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-700">{t(`dashboard.${label}`)}</h3>
                <p className="mt-2 text-2xl font-bold">{quality?.[key] ?? "—"}</p>
              </article>)}
            </div>
            {quality?.pendingSyncNote && <p className="mt-3 text-sm text-slate-600">{quality.pendingSyncNote}</p>}
          </section>

          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">{t("dashboard.village_coverage")}</h2>
            <p className="mb-4 mt-2 text-sm text-slate-600">{t("dashboard.village_coverage_note")}</p>
            {villages.length
              ? <div className="overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b text-slate-600">
                    <th className="p-3">{t("dashboard.village")}</th>
                    <th className="p-3">{t("dashboard.total_habitations")}</th>
                    <th className="p-3">{t("dashboard.screened_habitations")}</th>
                    <th className="p-3">{t("dashboard.pending_habitations")}</th>
                    <th className="p-3">{t("dashboard.average_coverage")}</th>
                  </tr></thead>
                  <tbody>{villages.map((village) => <tr key={village.villageId} className="border-b last:border-0">
                    <td className="p-3 font-semibold">{village.name}</td>
                    <td className="p-3">{village.totalHabitations}</td>
                    <td className="p-3">{village.screenedHabitations}</td>
                    <td className="p-3">{village.pendingHabitations}</td>
                    <td className="p-3">{village.averageCoverage}%</td>
                  </tr>)}</tbody>
                </table>
              </div>
              : <p className="text-slate-600">—</p>}
          </section>

          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">{t("dashboard.asha_activity")}</h2>
            <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(event) => void loadAshaActivity(event)}>
              <label className="min-w-60 flex-1 text-sm font-semibold">
                {t("dashboard.asha_id")}
                <input className="mt-1 min-h-touch w-full rounded-lg border p-3" value={ashaId} onChange={(event) => setAshaId(event.target.value)} />
              </label>
              <button className="min-h-touch rounded-lg bg-medical-700 px-5 font-bold text-white disabled:opacity-50" type="submit" disabled={!ashaId.trim() || ashaLoading}>
                {t("dashboard.view_activity")}
              </button>
            </form>
            {ashaError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-rose-800">{ashaError}</p>}
            {ashaLoading && <p className="mt-3 text-slate-600">{t("loading")}</p>}
            {ashaActivity && <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {activityMetrics.map(([key, label]) => <article key={key} className="rounded-xl bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-700">{t(`dashboard.${label}`)}</h3>
                  <p className="mt-2 text-2xl font-bold">{ashaActivity[key] === null ? "—" : `${ashaActivity[key]}${key === "usableImagePercent" && ashaActivity[key] !== null ? "%" : ""}`}</p>
                </article>)}
              </div>
              {ashaActivity.pendingSyncs === null && <p className="mt-3 text-sm text-slate-600">{t("dashboard.sync_metric_note")}</p>}
            </>}
          </section>
        </>}
    </main>
  </>;
}
