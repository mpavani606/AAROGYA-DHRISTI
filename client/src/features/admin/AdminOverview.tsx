import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiMessage } from "../auth/api";
import { getHospitalDetails, getHospitalOverview, type HospitalDetails, type HospitalOverview } from "./adminApi";

export default function AdminOverview() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<HospitalOverview>();
  const [selected, setSelected] = useState<HospitalDetails>();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getHospitalOverview().then((data) => {
      if (active) setOverview(data);
    }).catch((requestError: unknown) => {
      if (active) setError(getApiMessage(requestError, t("phase4.loadError")));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const hospitals = useMemo(() => overview?.hospitals.filter((hospital) =>
    [hospital.hospitalName, hospital.hospitalCode].some((value) => value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  ) ?? [], [overview, search]);

  async function viewDetails(hospitalId: string) {
    setLoadingDetails(true);
    setError("");
    try {
      setSelected(await getHospitalDetails(hospitalId));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase4.detailError")));
    } finally {
      setLoadingDetails(false);
    }
  }

  const statistics = overview?.statistics;
  return <section className="space-y-5">
    <h2 className="text-2xl font-bold">{t("phase4.adminOverview")}</h2>
    {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
    {loading ? <p role="status">{t("phase4.loading")}</p> : statistics && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[
        [t("phase4.totalHospitals"), statistics.totalHospitals],
        [t("phase4.activeHospitals"), statistics.activeHospitals],
        [t("phase4.inactiveHospitals"), statistics.inactiveHospitals],
        [t("phase4.totalDoctors"), statistics.totalDoctors],
        [t("phase4.activeDoctors"), statistics.activeDoctors],
        [t("phase4.managers"), statistics.hospitalManagers]
      ].map(([label, value]) => <article className="rounded-xl bg-white p-4 shadow-sm" key={label}>
        <p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p>
      </article>)}
    </div>}
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <label className="block font-semibold">{t("phase4.searchHospitals")}
          <input className="mt-1 w-full rounded-lg border p-3" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="mt-4 space-y-2" aria-live="polite">
          {!loading && hospitals.length === 0 && <p className="text-slate-600">{t("phase4.noHospitals")}</p>}
          {hospitals.map((hospital) => <button
            className="flex min-h-touch w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-slate-50"
            key={hospital.hospitalId}
            type="button"
            onClick={() => void viewDetails(hospital.hospitalId)}
          >
            <span><strong className="block">{hospital.hospitalName}</strong><span className="text-sm text-slate-600">{hospital.ownershipType === "private" ? "Private Hospital" : "Government Hospital"} · {hospital.hospitalCode ?? "—"}</span></span>
            <span className="text-sm">{hospital.activeDoctors}/{hospital.doctors} {t("phase4.doctors")}</span>
          </button>)}
        </div>
      </section>
      <section className="rounded-2xl bg-white p-5 shadow-sm" aria-live="polite">
        {loadingDetails ? <p role="status">{t("phase4.loading")}</p> : selected ? <>
          <h3 className="text-xl font-bold">{selected.hospital.name}</h3>
          <p className="text-sm text-slate-600">{selected.hospital.code} · {(selected.hospital.ownershipType ?? (["private", "Private"].includes(selected.hospital.type) ? "private" : "government")) === "private" ? "Private Hospital" : "Government Hospital"} · {selected.hospital.active ? t("phase4.active") : t("phase4.inactive")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <p>{t("phase4.doctors")}: <strong>{selected.statistics.assignedDoctors}</strong></p>
            <p>{t("phase4.activeDoctors")}: <strong>{selected.statistics.activeDoctors}</strong></p>
            <p>{t("phase4.upcomingAppointments")}: <strong>{selected.statistics.upcomingAppointments}</strong></p>
            <p>{t("phase4.completedAppointments")}: <strong>{selected.statistics.completedAppointments}</strong></p>
          </div>
          <h4 className="mt-5 font-bold">{t("phase4.managers")}</h4>
          {selected.managers.length ? <ul className="mt-2 space-y-1">{selected.managers.map((manager) => <li key={manager._id}>{manager.name} · {manager.status} · MFA {manager.mfaEnabled ? t("phase4.enabled") : t("phase4.notEnabled")}</li>)}</ul> : <p className="mt-2 text-slate-600">{t("phase4.noManagers")}</p>}
          <h4 className="mt-5 font-bold">{t("phase4.recentAudit")}</h4>
          {selected.auditLogs.length ? <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-sm">{selected.auditLogs.map((entry) => <li key={entry._id}>{new Date(entry.createdAt).toLocaleString()} · {entry.action} · {entry.actor?.name ?? t("phase4.unknownActor")}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">{t("phase4.auditUnavailable")}</p>}
          <p className="mt-4 text-sm text-slate-600">{t("phase4.noPatientDetails")}</p>
        </> : <p className="text-slate-600">{t("phase4.selectHospital")}</p>}
      </section>
    </div>
  </section>;
}
