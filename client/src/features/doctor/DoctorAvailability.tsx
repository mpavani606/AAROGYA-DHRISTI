import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "../auth/api";

type AvailabilitySlot = { id: string; start: string; end: string; booked: boolean };

const emptyForm = { start: "", end: "" };

export default function DoctorAvailability() {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSlots = useCallback(async () => {
    setError("");
    const { data } = await api.get<{ slots: AvailabilitySlot[] }>("/doctor/availability");
    setSlots(data.slots);
  }, []);

  useEffect(() => {
    void loadSlots()
      .catch((requestError: unknown) => setError(getApiMessage(requestError, "Unable to load availability.")))
      .finally(() => setLoading(false));
  }, [loadSlots]);

  async function addSlot(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.post("/doctor/availability", {
        start: new Date(form.start).toISOString(),
        end: new Date(form.end).toISOString()
      });
      setForm(emptyForm);
      setNotice("Availability saved.");
      await loadSlots();
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to save availability."));
    } finally {
      setSaving(false);
    }
  }

  async function removeSlot(slotId: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.delete(`/doctor/availability/${slotId}`);
      setSlots((current) => current.filter((slot) => slot.id !== slotId));
      setNotice("Availability removed.");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to remove availability."));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <SimulationBanner />
    <main className="mx-auto max-w-4xl space-y-5 px-4 pb-10 pt-24">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">Availability Management</h1>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link className="min-h-touch rounded-lg border px-4 py-2 font-semibold" to="/doctor">Doctor Dashboard</Link>
        </div>
      </header>
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">Schedule times use your device time zone. Existing appointments cannot be removed.</p>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
      {notice && <p className="rounded-lg bg-green-50 p-3 text-green-900" role="status">{notice}</p>}
      <form className="grid gap-4 rounded-2xl bg-white p-5 shadow-sm sm:grid-cols-2" onSubmit={(event) => void addSlot(event)}>
        <h2 className="text-xl font-bold sm:col-span-2">Add working hours</h2>
        <label className="font-semibold">Start<input className="mt-1 min-h-touch w-full rounded-lg border p-3" type="datetime-local" required value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} /></label>
        <label className="font-semibold">End<input className="mt-1 min-h-touch w-full rounded-lg border p-3" type="datetime-local" required min={form.start || undefined} value={form.end} onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))} /></label>
        <button className="primary min-h-touch sm:col-span-2" type="submit" disabled={saving}>{saving ? "Saving…" : "Add availability"}</button>
      </form>
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Upcoming availability</h2>
        {loading ? <p className="mt-4" role="status">Loading availability…</p>
          : slots.length === 0 ? <p className="mt-4 text-slate-600">No upcoming availability has been scheduled.</p>
            : <ul className="mt-4 space-y-3">{slots.map((slot) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" key={slot.id}>
              <span><strong>{new Date(slot.start).toLocaleString()}</strong><span className="mx-2">–</span>{new Date(slot.end).toLocaleString()}<small className="ml-3 rounded-full border px-2 py-1">{slot.booked ? "Booked" : "Available"}</small></span>
              {!slot.booked && <button className="min-h-touch rounded-lg border px-3 py-2 font-semibold disabled:opacity-50" type="button" disabled={saving} onClick={() => void removeSlot(slot.id)}>Remove</button>}
            </li>)}</ul>}
      </section>
    </main>
  </>;
}
