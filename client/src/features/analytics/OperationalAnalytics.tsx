import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { getApiMessage } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { getHospitals, getMandals, type Hospital, type Mandal } from "../admin/adminApi";
import {
  downloadOperationalReport,
  getAiMonitoring,
  getOperationalAnalytics,
  getSystemHealth,
  type AiMonitoring,
  type AnalyticsFilters,
  type AnalyticsSummary,
  type SystemHealth
} from "./analyticsApi";

const selectClass = "mt-1 min-h-touch w-full rounded-lg border border-slate-300 bg-white px-3";
const statusOptions = {
  screeningStatus: ["submitted", "ai_processed", "in_review", "routine_follow_up", "specialist_review", "urgent_referral", "recapture_requested", "deferred", "investigation_advised", "report_received", "clinician_reviewed", "treatment_linked", "follow_up", "closed_clinically", "lost_to_follow_up"],
  referralStatus: ["requested", "accepted", "scheduled", "completed", "cancelled"],
  followUpStatus: ["pending", "scheduled", "completed", "missed", "rescheduled", "cancelled"],
  appointmentStatus: ["requested", "confirmed", "rescheduled", "attended", "missed", "cancelled", "assessment_completed"]
} as const;

export default function OperationalAnalytics() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [draftFilters, setDraftFilters] = useState<AnalyticsFilters>({});
  const [mandals, setMandals] = useState<Mandal[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary>();
  const [aiMonitoring, setAiMonitoring] = useState<AiMonitoring>();
  const [health, setHealth] = useState<SystemHealth>();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextFilters: AnalyticsFilters) => {
    setLoading(true);
    setError("");
    try {
      if (user?.role === "system_admin") {
        const [nextAnalytics, nextAiMonitoring, nextHealth] = await Promise.all([
          getOperationalAnalytics(nextFilters),
          getAiMonitoring({ from: nextFilters.from, to: nextFilters.to }),
          getSystemHealth()
        ]);
        setAnalytics(nextAnalytics);
        setAiMonitoring(nextAiMonitoring);
        setHealth(nextHealth);
      } else {
        setAnalytics(await getOperationalAnalytics(nextFilters));
      }
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase8.loadError")));
      setAnalytics(undefined);
    } finally {
      setLoading(false);
    }
  }, [t, user?.role]);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  useEffect(() => {
    if (user?.role !== "district_admin" && user?.role !== "system_admin") return;
    let active = true;
    const request = user.role === "system_admin"
      ? Promise.all([getMandals(), getHospitals()]).then(([items, hospitalItems]) => {
        if (active) {
          setMandals(items);
          setHospitals(hospitalItems);
        }
      })
      : getMandals().then((items) => { if (active) setMandals(items); });
    void request.catch((requestError: unknown) => {
      if (active) setError(getApiMessage(requestError, t("phase8.loadError")));
    });
    return () => { active = false; };
  }, [t, user?.role]);

  function updateFilter(key: Exclude<keyof AnalyticsFilters, "page" | "pageSize">, value: string) {
    setDraftFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  async function exportReport(format: "csv" | "pdf", report: "analytics" | "ai" = "analytics") {
    setExporting(true);
    setError("");
    try {
      const reportFilters = report === "ai" ? { from: filters.from, to: filters.to } : filters;
      await downloadOperationalReport(reportFilters, format, report);
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase8.exportError")));
    } finally {
      setExporting(false);
    }
  }

  const cards = analytics ? [
    { key: "screenings", value: analytics.totals.screenings.total, detail: `${t("phase8.pendingReview")}: ${analytics.totals.screenings.pendingReview}` },
    { key: "referrals", value: analytics.totals.referrals.total, detail: `${t("phase8.failed")}: ${analytics.totals.referrals.byStatus.cancelled ?? 0}` },
    { key: "followUps", value: analytics.totals.followUps.total, detail: `${t("phase8.failed")}: ${analytics.totals.followUps.byStatus.missed ?? 0}` },
    { key: "appointments", value: analytics.totals.appointments.total, detail: `${t("phase8.upcoming", { defaultValue: "Upcoming" })}: ${analytics.totals.appointments.upcoming}` }
  ] as const : [];

  const statusFields = [
    ["screeningStatus", "screeningStatus"],
    ["referralStatus", "referralStatus"],
    ["followUpStatus", "followUpStatus"],
    ["appointmentStatus", "appointmentStatus"]
  ] as const;

  return <>
    <SimulationBanner />
    <main className="mx-auto max-w-7xl space-y-6 px-4 pb-12 pt-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-bold uppercase tracking-wide text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">{t("phase8.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("phase8.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LanguageSwitcher />
          <Link className="min-h-touch rounded-lg border px-4 py-2 font-semibold" to={user?.role === "system_admin" || user?.role === "district_admin" ? "/admin" : user?.role === "hospital_manager" ? "/hospital-manager" : "/doctor"}>{t("phase8.backToDashboard", { defaultValue: "Back to dashboard" })}</Link>
        </div>
      </header>

      <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="analytics-filters">
        <h2 id="analytics-filters" className="mb-4 text-xl font-bold">{t("phase8.filters")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block font-semibold">{t("phase8.from")}<input className={selectClass} type="date" value={draftFilters.from ?? ""} onChange={(event) => updateFilter("from", event.target.value)} /></label>
          <label className="block font-semibold">{t("phase8.to")}<input className={selectClass} type="date" value={draftFilters.to ?? ""} onChange={(event) => updateFilter("to", event.target.value)} /></label>
          {(user?.role === "district_admin" || user?.role === "system_admin") && <label className="block font-semibold">{t("phase8.mandal")}
            <select className={selectClass} value={draftFilters.mandalId ?? ""} onChange={(event) => updateFilter("mandalId", event.target.value)}>
              <option value="">{t("phase8.allMandals")}</option>
              {mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{mandal.name_en ?? mandal.name}</option>)}
            </select>
          </label>}
          {user?.role === "system_admin" && <label className="block font-semibold">{t("phase8.hospital")}
            <select className={selectClass} value={draftFilters.hospitalId ?? ""} onChange={(event) => updateFilter("hospitalId", event.target.value)}>
              <option value="">{t("phase8.allHospitals")}</option>
              {hospitals.map((hospital) => <option key={hospital._id} value={hospital._id}>{hospital.name}</option>)}
            </select>
          </label>}
          {statusFields.map(([key, labelKey]) => <label className="block font-semibold" key={key}>{t(`phase8.${labelKey}`)}
            <select className={selectClass} value={draftFilters[key] ?? ""} onChange={(event) => updateFilter(key, event.target.value)}>
              <option value="">{t("phase8.allStatuses")}</option>
              {statusOptions[key].map((status) => <option key={status} value={status}>{t(`phase8.statuses.${status}`, { defaultValue: status.replaceAll("_", " ") })}</option>)}
            </select>
          </label>)}
        </div>
        <button className="mt-4 min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="button" disabled={loading} onClick={() => setFilters({ ...draftFilters, page: 1 })}>{loading ? t("phase8.refreshing") : t("phase8.refresh")}</button>
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
      {loading ? <p className="rounded-xl bg-white p-5" role="status">{t("phase8.loading")}</p> : analytics ? <>
        <div className="flex flex-wrap gap-2">
          <button className="min-h-touch rounded-lg border bg-white px-4 font-semibold disabled:opacity-60" disabled={exporting} type="button" onClick={() => void exportReport("csv")}>{exporting ? t("phase8.exporting") : t("phase8.exportCsv")}</button>
          <button className="min-h-touch rounded-lg border bg-white px-4 font-semibold disabled:opacity-60" disabled={exporting} type="button" onClick={() => void exportReport("pdf")}>{exporting ? t("phase8.exporting") : t("phase8.exportPdf")}</button>
        </div>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("phase8.title")}>
          {cards.map((card) => <article className="rounded-xl bg-white p-4 shadow-sm" key={card.key}>
            <h2 className="text-sm font-semibold text-slate-600">{t(`phase8.${card.key}`)}</h2>
            <p className="mt-1 text-3xl font-bold">{card.value}</p>
            <p className="mt-1 text-sm text-slate-600">{card.detail}</p>
          </article>)}
        </section>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {user?.role !== "doctor" && <>
            <article className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">{t("phase8.registeredPatients")}</p><p className="text-2xl font-bold">{analytics.totals.registeredPatients ?? t("phase8.emptyValue")}</p></article>
            <article className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">{t("phase8.doctors")}</p><p className="text-2xl font-bold">{analytics.totals.doctors.total}</p><p className="text-sm text-slate-600">{t("phase8.pendingReview")}: {analytics.totals.doctors.pendingVerification}</p></article>
            <article className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">{t("phase8.activeHospitals")}</p><p className="text-2xl font-bold">{analytics.totals.activeHospitals}</p></article>
          </>}
        </section>
        <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="monthly-trend">
          <h2 id="monthly-trend" className="mb-4 text-xl font-bold">{t("phase8.monthlyTrend")}</h2>
          {analytics.monthlyTrend.length === 0 ? <p className="py-12 text-center text-slate-600">{t("phase8.noData")}</p> : <div className="h-80 w-full" role="img" aria-label={t("phase8.monthlyTrend")}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="_id" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="screenings" stroke="#e8a0b8" name={t("phase8.screenings")} />
                <Line type="monotone" dataKey="reviews" stroke="#bd718a" name={t("phase8.reviews")} />
                <Line type="monotone" dataKey="referrals" stroke="#d97706" name={t("phase8.referrals")} />
              </LineChart>
            </ResponsiveContainer>
          </div>}
        </section>

        {user?.role === "system_admin" && <>
          <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="ai-operations">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 id="ai-operations" className="text-xl font-bold">{t("phase8.aiMonitoring")}</h2><p className="mt-1 text-sm text-amber-900">{t("phase8.aiDisclaimer")}</p></div>
              <div className="flex gap-2">
                <button className="min-h-touch rounded-lg border px-3 font-semibold" disabled={exporting} type="button" onClick={() => void exportReport("csv", "ai")}>{t("phase8.exportCsv")}</button>
                <button className="min-h-touch rounded-lg border px-3 font-semibold" disabled={exporting} type="button" onClick={() => void exportReport("pdf", "ai")}>{t("phase8.exportPdf")}</button>
              </div>
            </div>
            {aiMonitoring && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t("phase8.completedRequests"), aiMonitoring.totals.completed],
                [t("phase8.failedRequests"), aiMonitoring.totals.failed],
                [t("phase8.unavailableRequests"), aiMonitoring.totals.unavailable],
                [t("phase8.averageDuration"), aiMonitoring.totals.averageDurationMs ?? t("phase8.emptyValue")]
              ].map(([label, value]) => <article className="rounded-lg border p-3" key={label}><p className="text-sm text-slate-600">{label}</p><p className="text-2xl font-bold">{value}</p></article>)}
            </div>}
            {aiMonitoring && aiMonitoring.modelVersions.length > 0 && <div className="mt-5 h-64 w-full" role="img" aria-label={t("phase8.aiMonitoring")}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aiMonitoring.modelVersions}>
                  <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="version" /><YAxis allowDecimals={false} /><Tooltip />
                  <Bar dataKey="requests" fill="#e8a0b8" name={t("phase8.requests")} />
                </BarChart>
              </ResponsiveContainer>
            </div>}
            {aiMonitoring && aiMonitoring.dailyMetrics.length > 0 && <div className="mt-5">
              <h3 className="mb-2 font-semibold">{t("phase8.dailyRequests")}</h3>
              <div className="h-72 w-full" role="img" aria-label={t("phase8.dailyRequests")}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={aiMonitoring.dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Legend />
                    <Line type="monotone" dataKey="completed" stroke="#e8a0b8" name={t("phase8.completedRequests")} />
                    <Line type="monotone" dataKey="failed" stroke="#dc2626" name={t("phase8.failedRequests")} />
                    <Line type="monotone" dataKey="unavailable" stroke="#d97706" name={t("phase8.unavailableRequests")} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>}
            {aiMonitoring && aiMonitoring.recentErrors.length > 0 && <div className="mt-5">
              <h3 className="font-semibold">{t("phase8.recentErrors")}</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {aiMonitoring.recentErrors.map((item, index) => <li key={`${item.createdAt}-${index}`}>{item.status} · {item.errorCode} · {new Date(item.createdAt).toLocaleString()}</li>)}
              </ul>
            </div>}
          </section>
          {health && <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="system-health">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="system-health" className="text-xl font-bold">{t("phase8.systemHealth")}</h2><p className="text-sm text-slate-600">{new Date(health.checkedAt).toLocaleString()}</p></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t("phase8.api"), health.api.status],
                [t("phase8.database"), health.database.status],
                [t("phase8.mediaStorage"), `${health.mediaStorage.mode}: ${health.mediaStorage.status}`],
                [t("phase8.aiMonitoring"), `${health.aiScreening.mode} · ${health.aiScreening.status}`]
              ].map(([label, value]) => <article className="rounded-lg border p-3" key={label}><p className="text-sm text-slate-600">{label}</p><p className="font-bold">{value}</p></article>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [t("phase8.apiRequests"), health.api.requestMetrics.totalRequests],
                [t("phase8.apiErrors"), health.api.requestMetrics.errorRequests],
                [t("phase8.serverErrors"), health.api.requestMetrics.serverErrors]
              ].map(([label, value]) => <article className="rounded-lg border p-3" key={label}><p className="text-sm text-slate-600">{label}</p><p className="text-xl font-bold">{value}</p></article>)}
            </div>
            <article className="rounded-lg border p-4">
              <h3 className="font-bold">{t("phase8.notifications")}</h3>
              <p className="mt-2 text-sm text-slate-700">{t("phase8.queued")}: {health.notifications.queued} · {t("phase8.sent")}: {health.notifications.sent} · {t("phase8.failed")}: {health.notifications.failed}</p>
            </article>
            <article className="overflow-x-auto rounded-lg border p-4">
              <h3 className="mb-2 font-bold">{t("phase8.backgroundJobs")}</h3>
              {health.backgroundJobs.length === 0 ? <p className="text-sm text-slate-600">{t("phase8.noJobs")}</p> : <table className="w-full text-left text-sm">
                <thead><tr><th className="p-2">{t("phase8.job")}</th><th className="p-2">{t("phase8.status")}</th><th className="p-2">{t("phase8.lastRun")}</th><th className="p-2">{t("phase8.requests")}</th></tr></thead>
                <tbody>{health.backgroundJobs.map((job) => <tr className="border-t" key={job.name}>
                  <td className="p-2">{job.name}</td><td className="p-2">{job.state}</td><td className="p-2">{job.lastCompletedAt ? new Date(job.lastCompletedAt).toLocaleString() : job.lastFailedAt ? new Date(job.lastFailedAt).toLocaleString() : t("phase8.emptyValue")}</td><td className="p-2">{job.runCount}</td>
                </tr>)}</tbody>
              </table>}
            </article>
          </section>}
        </>}
        <nav className="flex items-center justify-between gap-3" aria-label={t("phase8.monthlyTrend")}>
          <button className="min-h-touch rounded-lg border px-4 disabled:opacity-50" type="button" disabled={loading || analytics.pagination.page <= 1} onClick={() => { const next = { ...filters, page: analytics.pagination.page - 1 }; setFilters(next); setDraftFilters(next); }}>{t("phase8.previous")}</button>
          <p className="text-sm text-slate-500">{t("phase8.pageOf", { page: analytics.pagination.page, pages: Math.max(analytics.pagination.totalPages, 1) })}</p>
          <button className="min-h-touch rounded-lg border px-4 disabled:opacity-50" type="button" disabled={loading || analytics.pagination.page >= analytics.pagination.totalPages} onClick={() => { const next = { ...filters, page: analytics.pagination.page + 1 }; setFilters(next); setDraftFilters(next); }}>{t("phase8.next")}</button>
        </nav>
      </> : !error && <p className="rounded-xl bg-white p-5 text-slate-600">{t("phase8.noData")}</p>}
    </main>
  </>;
}
