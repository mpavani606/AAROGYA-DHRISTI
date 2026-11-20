import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import api, { getApiMessage } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { getPatientProfile, type PatientProfile } from "./patientApi";

type CessationPlan = { _id: string; goal: string; targetDate?: string; status: "active" | "completed" | "cancelled"; createdAt?: string };

export default function TobaccoTracker() {
  const { user } = useAuth();
  const [patient, setPatient] = useState<PatientProfile>();
  const [plans, setPlans] = useState<CessationPlan[]>([]);
  const [goal, setGoal] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const profile = await getPatientProfile();
    const { data } = await api.get<{ plans: CessationPlan[] }>(`/patients/${profile.id}/cessation-plans`);
    setPatient(profile);
    setPlans(data.plans);
  }, []);

  useEffect(() => {
    void refresh().catch((requestError: unknown) => setError(getApiMessage(requestError, "Unable to load cessation plans.")));
  }, [refresh]);

  const createPlan = async (event: FormEvent) => {
    event.preventDefault();
    if (!patient || !goal.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.post(`/patients/${patient.id}/cessation-plans`, { goal: goal.trim(), ...(targetDate ? { targetDate } : {}) });
      setGoal(""); setTargetDate("");
      await refresh();
      setNotice("Your plan has been saved.");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to save the plan."));
    } finally { setBusy(false); }
  };

  const completePlan = async (plan: CessationPlan) => {
    if (!patient) return;
    setError(""); setNotice("");
    try {
      await api.patch(`/patients/${patient.id}/cessation-plans/${plan._id}`, { status: "completed" });
      await refresh();
      setNotice("Plan marked complete.");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to update the plan."));
    }
  };

  return <><SimulationBanner /><main className="mx-auto max-w-3xl px-4 pb-12 pt-24">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><Link to="/" className="font-bold text-medical-800">← Dashboard</Link><p className="mt-3 text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">Tobacco cessation support</h1></div>
      <LanguageSwitcher />
    </header>
    <p className="mt-5 rounded-2xl border border-medical-200 bg-white p-5 leading-7 text-slate-700">Create a personal goal and track its status with your care team. This tool provides support, not medical advice; contact a healthcare professional for help quitting tobacco.</p>
    {error && <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-800" role="alert">{error}</p>}
    {notice && <p className="mt-4 rounded-xl bg-green-50 p-4 text-green-800" role="status">{notice}</p>}
    <form className="mt-5 grid gap-4 rounded-2xl bg-white p-5 shadow-sm sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={(event) => void createPlan(event)}>
      <label className="font-semibold">My goal<input className="mt-1 w-full rounded-lg border p-3" required maxLength={500} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="For example: discuss a quit plan with my doctor" /></label>
      <label className="font-semibold">Target date<input className="mt-1 w-full rounded-lg border p-3" type="date" min={new Date().toISOString().slice(0, 10)} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
      <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="submit" disabled={busy || !patient}>{busy ? "Saving…" : "Save goal"}</button>
    </form>
    <section className="mt-6 space-y-3" aria-label="Cessation plans">
      <h2 className="text-xl font-bold">Your plans</h2>
      {plans.filter((plan) => plan.status !== "cancelled").map((plan) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-medical-100 bg-white p-5 shadow-sm" key={plan._id}>
        <div><h3 className="font-bold">{plan.goal}</h3><p className="mt-1 text-sm text-slate-600">{plan.targetDate ? `Target date: ${new Date(plan.targetDate).toLocaleDateString()}` : "No target date set"} · {plan.status}</p></div>
        {plan.status === "active" && <button className="min-h-touch rounded-xl border border-medical-700 px-4 font-bold text-medical-800" type="button" onClick={() => void completePlan(plan)}>Mark complete</button>}
      </article>)}
      {plans.filter((plan) => plan.status !== "cancelled").length === 0 && <p className="rounded-2xl bg-white p-5 text-slate-600">No cessation plans yet. Add a goal above or ask your care team for help.</p>}
    </section>
    <p className="mt-6 text-sm text-slate-600">Signed in as {user?.name ?? "patient"}. Plan updates are stored in your authorized patient record.</p>
  </main></>;
}
