import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SimulationBanner } from "../../components/SimulationBanner";
import { getMandal, type MandalDetails } from "./adminApi";

const refreshIntervalMs = 30_000;

export default function MandalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<MandalDetails>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date>();

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("A mandal was not selected.");
      return;
    }

    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await getMandal(id);
        if (active) {
          setData(result);
          setError("");
          setUpdatedAt(new Date());
        }
      } catch {
        if (active) setError("Unable to load this mandal. Check your connection and try again.");
      } finally {
        if (active) setLoading(false);
        inFlight = false;
      }
    };

    setLoading(true);
    setError("");
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, refreshIntervalMs);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [id]);

  const displayCount = (value: number | null | undefined) => value === null || value === undefined ? "—" : value;
  const villageName = (village: MandalDetails["unassignedVillages"][number]) => village.name_en ?? village.name;

  return <><SimulationBanner /><main className="mx-auto max-w-5xl px-4 pb-10 pt-24">
    <button className="min-h-touch rounded-lg border px-4" type="button" onClick={() => navigate("/admin/navigator")}>Back to mandals</button>
    <p className="mt-5 text-sm text-slate-600">Mandal → PHC → Gram Panchayat → Village → Habitation</p>
    <h1 className="mt-2 text-3xl font-bold">{data?.mandal.name_en ?? data?.mandal.name ?? (loading ? "Loading…" : "Mandal")}</h1>
    {(data?.mandal.name_te ?? data?.mandal.teluguName) && <p className="text-lg text-medical-700">{data.mandal.name_te ?? data.mandal.teluguName}</p>}
    {data?.mandal.name_hi && <p className="text-slate-600">{data.mandal.name_hi}</p>}
    <p className="mt-1 text-xs text-slate-500" aria-live="polite">
      Live data refreshes every 30 seconds{updatedAt ? ` · Updated ${updatedAt.toLocaleTimeString()}` : ""}
    </p>
    {data && <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <article className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">PHCs</p><strong className="text-2xl">{displayCount(data.aggregates.phcCount)}</strong></article>
      <article className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">Villages</p><strong className="text-2xl">{displayCount(data.aggregates.villageCount)}</strong></article>
      <article className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">Habitations</p><strong className="text-2xl">{displayCount(data.aggregates.habitationCount)}</strong></article>
    </div>}
    {id && <button className="mt-5 min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white" type="button" onClick={() => navigate(`/admin/dashboard?mandalId=${encodeURIComponent(id)}`)}>View dashboard for this mandal</button>}
    {error && <p className="mt-4 rounded-lg bg-rose-50 p-4 text-rose-800" role="alert">{error}</p>}
    {loading && !data && <p className="mt-5 text-slate-600" role="status">Loading mandal details…</p>}
    {data && <div className="mt-8 space-y-4">
      {data.phcs.map((phc) => <section className="rounded-2xl bg-white p-5 shadow-sm" key={phc._id}>
        <h2 className="text-xl font-bold">PHC: {phc.name_en ?? phc.name}</h2>
        <p className="mt-1 text-sm text-slate-600">{phc.code}{phc.active ? " · Active" : " · Inactive"}</p>
        {phc.villages.length
          ? <ul className="mt-3 space-y-2">{phc.villages.map((village) => <li className="rounded-lg bg-medical-50 p-3" key={village._id}>
            <p className="font-semibold">{villageName(village)}</p>
            <p className="mt-1 text-sm text-slate-600">
              {village.gramPanchayatName ? `Gram Panchayat: ${village.gramPanchayatName} · ` : ""}
              Habitations: {displayCount(village.habitationCount)}
            </p>
          </li>)}</ul>
          : <p className="mt-3 text-sm text-slate-600">No villages are currently linked to this PHC.</p>}
      </section>)}
      {data.unassignedVillages.length > 0 && <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Villages without a linked PHC</h2>
        <ul className="mt-3 space-y-2">{data.unassignedVillages.map((village) => <li className="rounded-lg bg-medical-50 p-3" key={village._id}>
          <p className="font-semibold">{villageName(village)}</p>
          <p className="mt-1 text-sm text-slate-600">
            {village.gramPanchayatName ? `Gram Panchayat: ${village.gramPanchayatName} · ` : ""}
            Habitations: {displayCount(village.habitationCount)}
          </p>
        </li>)}</ul>
      </section>}
      {!data.phcs.length && !data.unassignedVillages.length && <p className="rounded-xl bg-white p-5 text-slate-700">No PHCs or villages are recorded for this mandal.</p>}
    </div>}
  </main></>;
}
