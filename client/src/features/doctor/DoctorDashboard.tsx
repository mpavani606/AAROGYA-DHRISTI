import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";

type VerificationStatus = "draft" | "pending" | "verified" | "rejected" | "suspended";
type DoctorProfile = {
  specialty?: string;
  hospitalName?: string;
  hospital?: { name?: string } | string;
  verificationStatus?: VerificationStatus;
};
type CaseItem = { _id: string };
type Appointment = {
  _id: string;
  type: "video" | "physical";
  startAt: string;
  endAt: string;
  status: string;
  hospital?: { name?: string };
};
type FollowUp = { id: string; scheduledAt: string; status: string; overdue: boolean };

const activeAppointmentStatuses = new Set(["requested", "confirmed", "rescheduled"]);
const activeFollowUpStatuses = new Set(["scheduled", "rescheduled"]);

export default function DoctorDashboard() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<DoctorProfile | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("draft");
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadDashboard = async () => {
      setLoading(true);
      setError("");
      try {
        const { data: profileData } = await api.get<{ profile: DoctorProfile | null }>("/doctor-profile");
        if (!active) return;
        const nextProfile = profileData.profile;
        const status = nextProfile?.verificationStatus ?? "draft";
        setProfile(nextProfile);
        setVerificationStatus(status);
        if (status !== "verified") return;

        const [queueResponse, appointmentResponse, followUpResponse] = await Promise.all([
          api.get<{ cases: CaseItem[] }>("/review/queue"),
          api.get<{ appointments: Appointment[] }>("/appointments"),
          api.get<{ followUps: FollowUp[] }>("/follow-ups/assigned")
        ]);
        if (!active) return;
        setCases(queueResponse.data.cases);
        setAppointments(appointmentResponse.data.appointments);
        setFollowUps(followUpResponse.data.followUps);
      } catch (requestError) {
        if (active) setError(getApiMessage(requestError, "Unable to load your doctor dashboard."));
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadDashboard();
    return () => { active = false; };
  }, []);

  const pendingAppointments = appointments.filter((appointment) =>
    activeAppointmentStatuses.has(appointment.status) && new Date(appointment.endAt) > new Date()
  );
  const activeFollowUps = followUps.filter((followUp) => activeFollowUpStatuses.has(followUp.status));
  const hospitalName = typeof profile?.hospital === "object" ? profile.hospital.name : profile?.hospitalName;

  async function signOut() {
    try {
      await logout();
    } catch (requestError) {
      setError(getApiMessage(requestError, "Your local session was cleared, but the server could not confirm sign-out."));
    }
  }

  return <>
    <SimulationBanner />
    <main className="mx-auto max-w-6xl space-y-6 px-4 pb-12 pt-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">Doctor Dashboard</h1>
          <p className="mt-2 text-slate-700">Welcome, {user?.name}. Manage your clinical work and appointments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LanguageSwitcher />
          <Link className="min-h-touch rounded-xl border px-4 py-2 font-semibold" to="/doctor/profile">Doctor profile</Link>
          <button className="min-h-touch rounded-xl border px-4 py-2 font-semibold" type="button" onClick={() => void signOut()}>Log out</button>
        </div>
      </header>

      <section className="grid gap-3 rounded-2xl border bg-white p-5 sm:grid-cols-3" aria-label="Doctor account summary">
        <div><h2 className="font-bold">{user?.name}</h2><p className="text-sm text-slate-600">{user?.email}</p></div>
        <p><span className="font-semibold">Specialty:</span> {profile?.specialty ?? "Not added"}</p>
        <p><span className="font-semibold">Hospital:</span> {hospitalName ?? "Not assigned"}</p>
      </section>

      {error && <p className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900" role="alert">{error}</p>}
      {verificationStatus !== "verified" && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5" role="status">
        <h2 className="text-lg font-bold">Professional verification: {verificationStatus}</h2>
        <p className="mt-2">Complete or check your professional profile to enable clinical workflows.</p>
        <Link className="mt-3 inline-flex font-bold text-medical-800 underline" to="/doctor/profile">Open doctor profile</Link>
      </section>}

      {loading ? <p className="rounded-xl bg-white p-5" role="status">Loading doctor dashboard…</p> : verificationStatus === "verified" && <>
        <section className="grid gap-4 sm:grid-cols-3" aria-label="Clinical workload">
          <Link className="rounded-2xl border bg-white p-5 transition hover:border-medical-500" to="/doctor/workspace#screening-review">
            <p className="text-sm font-semibold text-slate-600">Cases awaiting review</p>
            <p className="mt-2 text-3xl font-bold">{cases.length}</p>
            <span className="mt-2 inline-block text-sm font-semibold text-medical-800">Open review queue →</span>
          </Link>
          <Link className="rounded-2xl border bg-white p-5 transition hover:border-medical-500" to="/appointments#appointments">
            <p className="text-sm font-semibold text-slate-600">Upcoming appointments</p>
            <p className="mt-2 text-3xl font-bold">{pendingAppointments.length}</p>
            <span className="mt-2 inline-block text-sm font-semibold text-medical-800">Manage appointments →</span>
          </Link>
          <Link className="rounded-2xl border bg-white p-5 transition hover:border-medical-500" to="/doctor/workspace#follow-ups">
            <p className="text-sm font-semibold text-slate-600">Active follow-ups</p>
            <p className="mt-2 text-3xl font-bold">{activeFollowUps.length}</p>
            <span className="mt-2 inline-block text-sm font-semibold text-medical-800">View follow-ups →</span>
          </Link>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="doctor-actions-heading">
          <h2 id="doctor-actions-heading" className="text-xl font-bold">Quick actions</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link className="rounded-xl border p-4 font-semibold hover:border-medical-500" to="/doctor/workspace#screening-review">Review screening cases</Link>
            <Link className="rounded-xl border p-4 font-semibold hover:border-medical-500" to="/patient/new">Register a patient</Link>
            <Link className="rounded-xl border p-4 font-semibold hover:border-medical-500" to="/appointments">Appointments and consultations</Link>
            <Link className="rounded-xl border p-4 font-semibold hover:border-medical-500" to="/doctor/availability">Manage availability</Link>
            <Link className="rounded-xl border p-4 font-semibold hover:border-medical-500" to="/navigator">Mandal navigator</Link>
            <Link className="rounded-xl border p-4 font-semibold hover:border-medical-500" to="/analytics">Reports and analytics</Link>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="doctor-appointments-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="doctor-appointments-heading" className="text-xl font-bold">Upcoming appointments</h2>
            <Link className="font-semibold text-medical-800 underline" to="/appointments">View all</Link>
          </div>
          {pendingAppointments.length === 0 ? <p className="mt-3 text-slate-600">No upcoming appointments are scheduled.</p>
            : <ul className="mt-3 divide-y">{pendingAppointments.slice(0, 5).map((appointment) => <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={appointment._id}>
              <span><strong>{appointment.hospital?.name ?? (appointment.type === "video" ? "Video consultation" : "In-person appointment")}</strong><span className="ml-2 text-sm text-slate-600">{appointment.status}</span></span>
              <time className="text-sm text-slate-600" dateTime={appointment.startAt}>{new Date(appointment.startAt).toLocaleString()}</time>
            </li>)}</ul>}
        </section>
      </>}
    </main>
  </>;
}
