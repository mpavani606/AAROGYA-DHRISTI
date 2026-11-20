import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SimulationBanner } from "../../components/SimulationBanner";
import { getDistricts, getMandals, type District, type Mandal } from "./adminApi";

const refreshIntervalMs = 30_000;

export default function MandalNavigator() {
  const [districts, setDistricts] = useState<District[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [mandals, setMandals] = useState<Mandal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const [districtsLoaded, setDistrictsLoaded] = useState(false);
  const inFlight = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    void getDistricts()
      .then((rows) => {
        if (!active) return;
        setDistricts(rows);
        const alluri = rows.find((district) => district.code.toUpperCase().startsWith("ASR") || district.name.toLowerCase().includes("alluri"));
        setSelectedDistrict((current) => current || alluri?._id || (rows.length === 1 ? rows[0]._id : ""));
      })
      .catch(() => { if (active) setError("Unable to load district list."); })
      .finally(() => { if (active) setDistrictsLoaded(true); });
    return () => { active = false; };
  }, []);

  const refreshMandals = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    setError("");
    try {
      const rows = await getMandals(selectedDistrict || undefined);
      setMandals(rows);
      setUpdatedAt(new Date());
    } catch {
      setError("Unable to load mandals. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      inFlight.current = false;
    }
  }, [selectedDistrict]);

  useEffect(() => {
    if (!districtsLoaded) return;
    void refreshMandals();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshMandals();
    }, refreshIntervalMs);
    const refreshOnFocus = () => { if (document.visibilityState === "visible") void refreshMandals(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [districtsLoaded, refreshMandals]);

  const displayCount = (value: number | null | undefined) => value === null || value === undefined ? "—" : value;

  return <><SimulationBanner /><main className="mx-auto max-w-6xl px-4 pb-10 pt-24">
    <button className="mb-5 min-h-touch rounded-lg border px-4" type="button" onClick={() => navigate("/admin")}>Back to admin</button>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold">Mandal Navigator</h1>
        <p className="mt-2 text-slate-700">Live mandal and facility records. Programme coverage is synthetic and should be verified before operational use.</p>
        <p className="mt-1 text-xs text-slate-500" aria-live="polite">
          Refreshes every 30 seconds{updatedAt ? ` · Updated ${updatedAt.toLocaleTimeString()}` : ""}
        </p>
      </div>
      {districts.length > 1 && <label className="text-sm font-semibold">
        District
        <select className="mt-1 min-h-touch rounded-lg border bg-white px-3" value={selectedDistrict} onChange={(event) => setSelectedDistrict(event.target.value)}>
          <option value="">All assigned districts</option>
          {districts.map((district) => <option key={district._id} value={district._id}>{district.name_en ?? district.name}</option>)}
        </select>
      </label>}
    </header>

    {error && <p className="mt-4 rounded-lg bg-rose-50 p-4 text-rose-800" role="alert">{error}</p>}
    {loading && <p className="mt-5 text-slate-600" role="status">Loading mandals…</p>}
    {!loading && !mandals.length && !error && <p className="mt-5 rounded-xl bg-white p-5 text-slate-700">No mandals are available for this district.</p>}

    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {mandals.map((mandal) => <button
        className="min-h-[180px] rounded-2xl bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 focus:outline-none focus:ring-4 focus:ring-teal-200"
        key={mandal._id}
        type="button"
        onClick={() => navigate(`/admin/navigator/${mandal._id}`)}
      >
        <span className="text-3xl" aria-hidden>🗺️</span>
        <h2 className="mt-3 text-xl font-bold">{mandal.name_en ?? mandal.name}</h2>
        {(mandal.name_te ?? mandal.teluguName) && <p className="text-lg text-medical-700">{mandal.name_te ?? mandal.teluguName}</p>}
        {mandal.name_hi && <p className="text-slate-600">{mandal.name_hi}</p>}
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <span>PHCs: <b>{displayCount(mandal.phcCount)}</b></span>
          <span>Villages: <b>{displayCount(mandal.villageCount)}</b></span>
          <span>Habitations: <b>{displayCount(mandal.habitationCount)}</b></span>
        </div>
      </button>)}
    </div>
    {refreshing && !loading && <span className="sr-only" role="status">Refreshing mandal data</span>}
  </main></>;
}
