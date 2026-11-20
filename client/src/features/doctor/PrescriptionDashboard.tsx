import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { getApiMessage } from "../auth/api";

type MedicineItem = {
  medicineName: string;
  category: string;
  strength?: string;
  dosage: string;
  frequency?: string;
  durationDays?: number;
  quantity?: string;
  instructions?: string;
};

type PrescriptionItem = {
  _id: string;
  prescriptionId?: string;
  patient?: { _id?: string; name?: string; patientCode?: string };
  doctor?: string;
  doctorUser?: { name?: string };
  prescriptionDate: string;
  status: "active" | "completed" | "pending" | "cancelled";
  medicines: MedicineItem[];
  medicineName: string;
  dosage: string;
  notes?: string;
  isDemoData: boolean;
};

type DashboardResponse = {
  prescriptions: PrescriptionItem[];
  pagination: { page: number; pageSize: number; totalRecords: number; totalPages: number };
  statistics: { total: number; active: number; completed: number; pending: number; cancelled: number; demo: number };
  categories: string[];
};

const statusClass: Record<PrescriptionItem["status"], string> = {
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-slate-100 text-slate-700",
  pending: "bg-amber-100 text-amber-800",
  cancelled: "bg-rose-100 text-rose-800"
};

function DemoNotice() {
  return (
    <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>DEMO RECORDS ARE NOT FOR CLINICAL USE.</strong> Demo rows are fictional, explicitly labeled, and are not valid medical prescriptions or treatment guidance.
    </div>
  );
}

export default function PrescriptionDashboard() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<DashboardResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api.get<DashboardResponse>("/prescriptions", {
      params: {
        q: debouncedSearch || undefined,
        status: status || undefined,
        date: date || undefined,
        category: category || undefined,
        page,
        limit: 10
      }
    }).then(({ data }) => {
      if (active) setResponse(data);
    }).catch((requestError: unknown) => {
      if (active) setError(getApiMessage(requestError, "Unable to load prescription records."));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [debouncedSearch, status, date, category, page, retryVersion]);

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link className="text-sm font-semibold text-medical-700 underline" to="/doctor">Doctor dashboard</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Medicines &amp; Prescriptions</h1>
          <p className="mt-1 text-sm text-slate-600">Prescription records for patients in your assigned care area.</p>
        </div>
      </header>
      <DemoNotice />

      <section aria-label="Prescription statistics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["All records", response?.statistics.total],
          ["Active", response?.statistics.active],
          ["Completed", response?.statistics.completed],
          ["Pending", response?.statistics.pending]
        ].map(([label, count]) => (
          <article className="rounded-xl border bg-white p-4 shadow-sm" key={label}>
            <p className="text-sm text-slate-600">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{count ?? (loading ? "…" : "0")}</p>
          </article>
        ))}
      </section>
      <p className="text-sm text-slate-600">Demo records in database: <strong>{response?.statistics.demo ?? (loading ? "…" : 0)}</strong></p>

      <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            Search patient, patient ID, prescription ID, doctor, or medicine
            <input
              className="mt-1 min-h-11 w-full rounded-lg border px-3"
              type="search"
              value={search}
              onChange={(event) => updateFilter(setSearch, event.target.value)}
              placeholder="Search records"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Status
            <select className="mt-1 min-h-11 w-full rounded-lg border px-3" value={status} onChange={(event) => updateFilter(setStatus, event.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Prescription date
            <input className="mt-1 min-h-11 w-full rounded-lg border px-3" type="date" value={date} onChange={(event) => updateFilter(setDate, event.target.value)} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Medicine category
            <select className="mt-1 min-h-11 w-full rounded-lg border px-3" value={category} onChange={(event) => updateFilter(setCategory, event.target.value)}>
              <option value="">All categories</option>
              {(response?.categories ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        {error && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error} <button type="button" className="ml-2 font-bold underline" onClick={() => setRetryVersion((current) => current + 1)}>Retry</button></div>}
        {loading ? (
          <p role="status" className="py-8 text-center text-slate-600">Loading prescriptions…</p>
        ) : !error && (response?.prescriptions.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-slate-600">No prescription records match these filters.</p>
        ) : !error && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead><tr className="border-b text-slate-600"><th className="p-3">Prescription ID</th><th className="p-3">Patient</th><th className="p-3">Medicine</th><th className="p-3">Doctor</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3">Details</th></tr></thead>
                <tbody>
                  {response?.prescriptions.map((item) => (
                    <tr className="border-b last:border-0" key={item._id}>
                      <td className="p-3 font-semibold">{item.prescriptionId ?? item._id}{item.isDemoData && <span className="ml-2 rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">DEMO</span>}</td>
                      <td className="p-3">{item.patient?.name ?? "Patient"}<span className="block text-xs text-slate-500">{item.patient?.patientCode ?? item.patient?._id ?? "—"}</span></td>
                      <td className="p-3">{item.medicines?.[0]?.medicineName ?? item.medicineName}<span className="block text-xs text-slate-500">{item.medicines?.[0]?.category ?? "—"}</span></td>
                      <td className="p-3">{item.doctorUser?.name ?? item.doctor ?? "—"}</td>
                      <td className="p-3">{item.prescriptionDate}</td>
                      <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass[item.status]}`}>{item.status}</span></td>
                      <td className="p-3"><button className="min-h-9 rounded-lg border border-medical-700 px-3 font-semibold text-medical-800 hover:bg-medical-50" type="button" onClick={() => navigate(`/doctor/prescriptions/${encodeURIComponent(item._id)}`)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">{response?.pagination.totalRecords ?? 0} records · Page {response?.pagination.page ?? 1} of {Math.max(response?.pagination.totalPages ?? 0, 1)}</p>
              <div className="flex gap-2">
                <button className="min-h-10 rounded-lg border px-4 font-semibold disabled:opacity-50" type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
                <button className="min-h-10 rounded-lg border px-4 font-semibold disabled:opacity-50" type="button" disabled={page >= (response?.pagination.totalPages ?? 0)} onClick={() => setPage((current) => current + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export function PrescriptionDetailsPage() {
  const { prescriptionId = "" } = useParams();
  const [prescription, setPrescription] = useState<PrescriptionItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api.get<{ prescription: PrescriptionItem }>(`/prescriptions/${encodeURIComponent(prescriptionId)}`)
      .then(({ data }) => { if (active) setPrescription(data.prescription); })
      .catch((requestError: unknown) => { if (active) setError(getApiMessage(requestError, "Unable to load prescription details.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [prescriptionId]);

  async function downloadPdf() {
    setDownloading(true);
    setError("");
    try {
      const { data } = await api.get<Blob>(`/prescriptions/${encodeURIComponent(prescriptionId)}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${prescription?.prescriptionId ?? "demo-prescription"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to download this demo PDF."));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <main className="mx-auto max-w-4xl p-6"><p role="status">Loading prescription details…</p></main>;
  if (error && !prescription) return <main className="mx-auto max-w-4xl space-y-4 p-6"><p role="alert" className="text-rose-800">{error}</p><Link className="font-semibold text-medical-700 underline" to="/doctor/prescriptions">Back to prescriptions</Link></main>;
  if (!prescription) return null;

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <Link className="font-semibold text-medical-700 underline" to="/doctor/prescriptions">← Back to prescriptions</Link>
      {prescription.isDemoData && <DemoNotice />}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-900">{error}</p>}
      <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm text-slate-600">Prescription ID</p><h1 className="text-2xl font-bold">{prescription.prescriptionId ?? prescription._id}</h1></div>
          {prescription.isDemoData && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-950">DEMO DATA</span>}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-sm text-slate-500">Patient</dt><dd className="font-semibold">{prescription.patient?.name ?? "Patient"}</dd><dd className="text-sm text-slate-600">{prescription.patient?.patientCode ?? prescription.patient?._id ?? "—"}</dd></div>
          <div><dt className="text-sm text-slate-500">Doctor</dt><dd className="font-semibold">{prescription.doctorUser?.name ?? prescription.doctor ?? "—"}</dd></div>
          <div><dt className="text-sm text-slate-500">Prescription date</dt><dd className="font-semibold">{prescription.prescriptionDate}</dd></div>
          <div><dt className="text-sm text-slate-500">Status</dt><dd className="font-semibold capitalize">{prescription.status}</dd></div>
        </dl>
        <div className="border-t pt-4">
          <h2 className="text-lg font-bold">Medicine information</h2>
          {(prescription.medicines?.length ? prescription.medicines : [{ medicineName: prescription.medicineName, category: "—", dosage: prescription.dosage }]).map((medicine, index) => (
            <article className="mt-3 rounded-xl border p-4" key={`${medicine.medicineName}-${index}`}>
              <h3 className="font-bold">{medicine.medicineName}</h3>
              <p className="text-sm text-slate-600">Category: {medicine.category} · Strength: {medicine.strength ?? "—"}</p>
              <p className="mt-2 text-sm"><strong>Sample dosage:</strong> {medicine.dosage}</p>
              {medicine.frequency && <p className="text-sm"><strong>Frequency:</strong> {medicine.frequency}</p>}
              {medicine.durationDays && <p className="text-sm"><strong>Sample duration:</strong> {medicine.durationDays} days</p>}
              {medicine.quantity && <p className="text-sm"><strong>Quantity:</strong> {medicine.quantity}</p>}
              {medicine.instructions && <p className="mt-2 text-sm">{medicine.instructions}</p>}
            </article>
          ))}
        </div>
        {prescription.notes && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{prescription.notes}</p>}
        {prescription.isDemoData && <button className="min-h-11 rounded-lg bg-medical-700 px-4 font-semibold text-white disabled:opacity-60" type="button" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? "Preparing PDF…" : "Download demo PDF"}</button>}
      </section>
    </main>
  );
}
