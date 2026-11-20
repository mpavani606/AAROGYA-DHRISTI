import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api, { getApiMessage } from "../auth/api";
import { getPatientProfile } from "./patientApi";

type CareData = {
  cases: Array<{
    id: string;
    status: string;
    createdAt: string;
    doctorReview: { status: string; decision?: string; reviewedAt?: string };
    imageQuality: string[];
    aiResult: { category: string | null; processingStatus: string; clinicallyValidated?: boolean; model?: { name?: string; version?: string }; processedAt?: string };
  }>;
  referrals: Array<{ id: string; reference: string; specialty: string; destination?: { name?: string }; status: string; createdAt: string }>;
  appointments: Array<{ id: string; hospital?: { name?: string }; startAt: string; status: string }>;
  followUps: Array<{ id: string; scheduledAt: string; status: string; overdue: boolean }>;
};

const resultKey: Record<string, string> = {
  INSUFFICIENT_IMAGE_QUALITY: "insufficientQuality",
  AI_PROCESSING_UNAVAILABLE: "aiUnavailable"
};

export default function PatientCareSummary() {
  const { t, i18n } = useTranslation();
  const [care, setCare] = useState<CareData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getPatientProfile().then((patient) =>
      api.get<CareData>(`/patients/${patient.id}/care-overview`)
    ).then(({ data }) => {
      if (active) setCare(data);
    }).catch((requestError: unknown) => {
      if (active) setError(getApiMessage(requestError, t("phase7.careError")));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [t]);

  async function downloadReport() {
    setReportBusy(true);
    setError("");
    try {
      const patient = await getPatientProfile();
      const { data } = await api.get(`/patients/${patient.id}/medical-report`, { responseType: "blob" });
      const url = URL.createObjectURL(data as Blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "aarogya-drishTi-simulation-report.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase7.reportError")));
    } finally {
      setReportBusy(false);
    }
  }

  const labelStatus = (value: string) => t(`phase7.${value}`, { defaultValue: value.replaceAll("_", " ") });
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return <section className="mt-8 rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="patient-care-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="patient-care-title" className="text-xl font-bold">{t("phase7.careTitle")}</h2>
      <button className="min-h-touch rounded-xl border px-4 font-bold disabled:opacity-60" type="button" onClick={() => void downloadReport()} disabled={reportBusy || loading}>
        {reportBusy ? t("loading") : t("phase7.reportDownload")}
      </button>
    </div>
    <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">{t("phase7.screeningDisclaimer")}</p>
    {loading && <p className="mt-4" role="status">{t("phase7.loadingCare")}</p>}
    {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-rose-800" role="alert">{error}</p>}
    {!loading && care && <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border p-4">
        <h3 className="font-bold">{t("phase7.screeningHistory")}</h3>
        {care.cases.length === 0 ? <p className="mt-3 text-sm text-slate-600">{t("phase7.noCases")}</p> : <div className="mt-3 space-y-3">
          {care.cases.map((item) => {
            const result = item.aiResult.clinicallyValidated && item.aiResult.category
              ? t(`phase7.${resultKey[item.aiResult.category] ?? "aiUnavailable"}`)
              : item.aiResult.processingStatus === "demo_not_validated"
                ? t("phase7.demoNotValidated")
                : t("phase7.aiNotStarted");
            return <article key={item.id} className="rounded-lg border p-3">
              <p className="font-semibold">{t("phase7.reference")}: {item.id.slice(-8)} · {labelStatus(item.status)}</p>
              <p className="mt-1 text-sm">{new Date(item.createdAt).toLocaleString(locale)} · {t("phase7.doctorReview")}: {labelStatus(item.doctorReview.status)}</p>
              <p className="mt-1 text-sm">{t("phase7.aiResult")}: {result}</p>
              <p className="mt-1 text-xs text-slate-600">{t("phase7.imageQuality")}: {item.imageQuality.map(labelStatus).join(", ") || "—"}</p>
              {item.aiResult.model?.version && <p className="mt-1 text-xs text-slate-600">{t("phase7.modelVersion")}: {item.aiResult.model.name} {item.aiResult.model.version}</p>}
              {item.aiResult.processedAt && <p className="mt-1 text-xs text-slate-600">{t("phase7.processedAt")}: {new Date(item.aiResult.processedAt).toLocaleString(locale)}</p>}
            </article>;
          })}
        </div>}
      </section>
      <section className="rounded-xl border p-4">
        <h3 className="font-bold">{t("phase7.referralStatus")}</h3>
        {care.referrals.length === 0 ? <p className="mt-3 text-sm text-slate-600">{t("phase7.noReferrals")}</p> : <div className="mt-3 space-y-2">
          {care.referrals.map((item) => <article key={item.id} className="rounded-lg border p-3 text-sm">
            <p className="font-semibold">{t("phase7.reference")}: {item.reference} · {labelStatus(item.status)}</p>
            <p>{item.destination?.name ?? item.specialty} · {item.specialty}</p>
            <p className="text-slate-600">{new Date(item.createdAt).toLocaleString(locale)}</p>
          </article>)}
        </div>}
      </section>
      <section className="rounded-xl border p-4">
        <h3 className="font-bold">{t("phase7.upcomingAppointments")}</h3>
        {care.appointments.length === 0 ? <p className="mt-3 text-sm text-slate-600">{t("phase7.noAppointments")}</p> : <div className="mt-3 space-y-2">
          {care.appointments.map((item) => <article key={item.id} className="rounded-lg border p-3 text-sm">
            <p className="font-semibold">{new Date(item.startAt).toLocaleString(locale)} · {labelStatus(item.status)}</p>
            <p className="text-slate-600">{item.hospital?.name ?? "—"}</p>
          </article>)}
        </div>}
      </section>
      <section className="rounded-xl border p-4">
        <h3 className="font-bold">{t("phase7.followUpSchedule")}</h3>
        {care.followUps.length === 0 ? <p className="mt-3 text-sm text-slate-600">{t("phase7.noFollowUps")}</p> : <div className="mt-3 space-y-2">
          {care.followUps.map((item) => <article key={item.id} className="rounded-lg border p-3 text-sm">
            <p className="font-semibold">{new Date(item.scheduledAt).toLocaleString(locale)} · {labelStatus(item.status)}</p>
            {item.overdue && <p className="mt-1 text-amber-800">{t("phase7.overdue")}</p>}
          </article>)}
        </div>}
      </section>
    </div>}
  </section>;
}
