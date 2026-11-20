import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiMessage } from "../auth/api";
import {
  createAshaWorker,
  getAshaAssignmentOptions,
  getAshaWorkers,
  setAshaWorkerStatus,
  type AshaWorker,
  type AshaAssignmentOptions
} from "./adminApi";

const fieldClass = "mt-1 min-h-touch w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

export default function AshaWorkerAdmin() {
  const [options, setOptions] = useState<AshaAssignmentOptions>();
  const [workers, setWorkers] = useState<AshaWorker[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setupLink, setSetupLink] = useState("");
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "", phcId: "", villageId: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextOptions, nextWorkers] = await Promise.all([getAshaAssignmentOptions(), getAshaWorkers()]);
      setOptions(nextOptions);
      setWorkers(nextWorkers);
      setForm((current) => ({ ...current, phcId: current.phcId || nextOptions.phcs[0]?._id || "", villageId: current.villageId || "" }));
    } catch (requestError) { setError(getApiMessage(requestError, "Unable to load ASHA worker accounts and assignment options.")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const villages = useMemo(() => options?.villages.filter((village) => village.phc === form.phcId) ?? [], [form.phcId, options]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSetupLink("");
    setBusy(true);
    try {
      const result = await createAshaWorker({
        name: form.name, username: form.username, email: form.email || undefined, phone: form.phone || undefined,
        phcId: form.phcId, villageId: form.villageId
      });
      setSetupLink(`${window.location.origin}/asha/setup#token=${encodeURIComponent(result.setupToken)}`);
      setNotice(`Account created. Deliver the one-time setup link securely; it expires ${new Date(result.setupExpiresAt).toLocaleString()}.`);
      setForm((current) => ({ ...current, name: "", username: "", email: "", phone: "" }));
      await refresh();
    } catch (requestError) { setError(getApiMessage(requestError, "Unable to create the ASHA worker account.")); }
    finally { setBusy(false); }
  }

  async function changeStatus(worker: AshaWorker) {
    setError("");
    setNotice("");
    try {
      await setAshaWorkerStatus(worker._id, worker.status === "active" ? "disabled" : "active");
      setWorkers((current) => current.map((item) => item._id === worker._id ? { ...item, status: item.status === "active" ? "disabled" : "active" } : item));
    } catch (requestError) { setError(getApiMessage(requestError, "Unable to update the ASHA worker account.")); }
  }

  return <section className="space-y-6">
    {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
    {notice && <p className="rounded-lg bg-green-50 p-3 text-green-900" role="status">{notice}</p>}
    {setupLink && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-amber-950">One-time password setup link</p>
      <p className="mt-1 break-all text-sm text-amber-900">Share this link with the worker through a secure channel. It is shown only in this page session and expires automatically.</p>
      <input className={fieldClass} aria-label="One-time ASHA password setup link" readOnly value={setupLink} onFocus={(event) => event.currentTarget.select()} />
    </div>}
    <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void submit(event)}>
      <h2 className="text-xl font-bold">Create ASHA worker account</h2>
      <p className="text-sm text-slate-600">System administrator provisioning only. The worker must set a password and enroll multi-factor authentication before accessing patient workflows.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block font-semibold">Full name<input className={fieldClass} autoComplete="name" minLength={2} maxLength={100} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="block font-semibold">Username<input className={fieldClass} autoComplete="username" minLength={3} maxLength={50} pattern="[a-zA-Z0-9._-]+" required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label className="block font-semibold">Email (optional)<input className={fieldClass} type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="block font-semibold">Phone (optional)<input className={fieldClass} type="tel" autoComplete="tel" minLength={7} maxLength={20} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="block font-semibold">Assigned PHC<select className={fieldClass} required value={form.phcId} onChange={(event) => setForm({ ...form, phcId: event.target.value, villageId: "" })}><option value="">Select a PHC</option>{options?.phcs.map((phc) => <option value={phc._id} key={phc._id}>{phc.name_en ?? phc.name}</option>)}</select></label>
        <label className="block font-semibold">Assigned village<select className={fieldClass} required value={form.villageId} onChange={(event) => setForm({ ...form, villageId: event.target.value })}><option value="">Select a village</option>{villages.map((village) => <option value={village._id} key={village._id}>{village.name_en ?? village.name}</option>)}</select></label>
      </div>
      {!loading && options?.phcs.length === 0 && <p className="text-sm text-amber-800">No active PHCs are available for assignment.</p>}
      <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="submit" disabled={busy || loading || !form.phcId || !form.villageId}>{busy ? "Creating…" : "Create account"}</button>
    </form>

    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-xl font-bold">ASHA worker accounts</h2>
      {loading ? <p role="status">Loading accounts…</p> : workers.length === 0 ? <p className="text-slate-600">No ASHA worker accounts have been provisioned.</p> : <div className="space-y-3">
        {workers.map((worker) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" key={worker._id}>
          <div><h3 className="font-bold">{worker.name}</h3><p className="text-sm text-slate-600">{worker.username} · {worker.phone ?? worker.email ?? "No contact"} · {worker.status} · MFA {worker.mfaEnabled ? "enabled" : "pending"}</p><p className="text-sm text-slate-600">{worker.assignments.map((assignment) => `${assignment.phc ?? "PHC"} / ${assignment.village ?? "village"}`).join(", ")}</p></div>
          <button className="min-h-touch rounded-lg border px-4" type="button" onClick={() => void changeStatus(worker)}>{worker.status === "active" ? "Deactivate" : "Activate"}</button>
        </article>)}
      </div>}
    </section>
  </section>;
}
