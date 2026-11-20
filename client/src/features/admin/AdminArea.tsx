import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";
import { getApiMessage } from "../auth/api";
import { assignDoctorHospitalProfile, createDoctor, getDoctorDetails, getDoctorDocument, getDoctors, getHospitals, getMandals, reviewDoctorVerification, saveDoctorAssignment, saveHospital, setDoctorStatus, type Doctor, type DoctorDetails, type DoctorStats, type Hospital, type Mandal } from "./adminApi";
import AdminOverview from "./AdminOverview";
import HospitalForm from "./HospitalForm";
import HospitalManagerAdmin from "./HospitalManagerAdmin";
import AshaWorkerAdmin from "./AshaWorkerAdmin";

type AdminTab = "overview" | "hospitals" | "doctors" | "managers" | "asha";

export default function AdminArea() {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<AdminTab>(user?.role === "system_admin" ? "overview" : "hospitals");
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorStats, setDoctorStats] = useState<DoctorStats>();
  const [doctorVerificationFilter, setDoctorVerificationFilter] = useState("all");
  const [doctorDetails, setDoctorDetails] = useState<DoctorDetails | null>(null);
  const [doctorDetailLoading, setDoctorDetailLoading] = useState(false);
  const [doctorReviewNote, setDoctorReviewNote] = useState("");
  const [mandals, setMandals] = useState<Mandal[]>([]);
  const [doctorMandals, setDoctorMandals] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Hospital>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [doctorForm, setDoctorForm] = useState({ username: "", email: "", phone: "", password: "", mandalId: "" });
  const [hospitalProfileForm, setHospitalProfileForm] = useState({ doctorId: "", hospitalId: "", registrationNo: "", specialty: "" });
  const [busy, setBusy] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState("");

  useEffect(() => {
    void getMandals().then(setMandals).catch((requestError: unknown) => setError(getApiMessage(requestError, "Unable to load mandals.")));
  }, []);

  useEffect(() => {
    if (tab === "managers" || tab === "overview" || tab === "asha") return;
    let active = true;
    setError("");
    const request = tab === "hospitals"
      ? getHospitals(search).then((results) => ({ hospitals: results, doctors: null, stats: null }))
      : Promise.all([getDoctors(search, doctorVerificationFilter === "all" ? undefined : doctorVerificationFilter as NonNullable<Doctor["hospitalProfile"]>["verificationStatus"]), user?.role === "system_admin" ? getHospitals() : Promise.resolve([])])
        .then(([results, hospitalResults]) => ({ hospitals: hospitalResults, doctors: results.doctors, stats: results.stats }));
    void request.then(({ hospitals: nextHospitals, doctors: nextDoctors, stats }) => {
      if (!active) return;
      setHospitals(nextHospitals);
      if (nextDoctors) {
        setDoctors(nextDoctors);
        if (stats) setDoctorStats(stats);
        setDoctorMandals((current) => Object.fromEntries(nextDoctors.map((doctor) => [doctor._id, current[doctor._id] ?? doctor.assignments?.find((assignment) => assignment.mandal)?.mandal ?? ""])));
      }
    }).catch((requestError: unknown) => {
      if (active) setError(getApiMessage(requestError, `Unable to load ${tab}.`));
    });
    return () => { active = false; };
  }, [tab, search, doctorVerificationFilter, refreshKey, user?.role]);

  async function toggleHospital(hospital: Hospital) {
    setError("");
    try {
      await saveHospital({ ...hospital, active: !hospital.active });
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to update hospital."));
    }
  }

  async function submitDoctor(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const selectedMandal = mandals.find((mandal) => mandal._id === doctorForm.mandalId);
      await createDoctor({ ...doctorForm, mandalName: selectedMandal?.name_en ?? selectedMandal?.name });
      setDoctorForm({ username: "", email: "", phone: "", password: "", mandalId: "" });
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to create doctor account."));
    } finally {
      setBusy(false);
    }
  }

  async function assignDoctor(userId: string) {
    setSavingAssignment(userId); setError("");
    try {
      const doctor = doctors.find((item) => item._id === userId);
      if (!doctor) throw new Error("Doctor account was not found. Reload and retry.");
      const selectedMandal = mandals.find((mandal) => mandal._id === doctorMandals[userId]);
      await saveDoctorAssignment(userId, doctorMandals[userId] ?? "", selectedMandal?.name_en ?? selectedMandal?.name ?? "", doctor.assignments ?? []);
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to update doctor assignment."));
    } finally {
      setSavingAssignment("");
    }
  }

  async function assignDoctorProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await assignDoctorHospitalProfile(hospitalProfileForm.doctorId, {
        hospitalId: hospitalProfileForm.hospitalId,
        registrationNo: hospitalProfileForm.registrationNo.trim(),
        specialty: hospitalProfileForm.specialty.trim()
      });
      setHospitalProfileForm({ doctorId: "", hospitalId: "", registrationNo: "", specialty: "" });
      setNotice(t("phase4.profileAssigned"));
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase4.profileAssignmentError")));
    } finally {
      setBusy(false);
    }
  }

  async function loadDoctorDetails(userId: string) {
      setDoctorDetailLoading(true);
      setError("");
      try {
        setDoctorDetails((await getDoctorDetails(userId)));
      } catch (requestError) {
        setError(getApiMessage(requestError, "Unable to load doctor details."));
      } finally {
        setDoctorDetailLoading(false);
      }
  }

  async function reviewDoctor(userId: string, decision: "verified" | "rejected" | "suspended") {
      setError("");
      setNotice("");
      try {
        await reviewDoctorVerification(userId, decision, doctorReviewNote.trim() || undefined);
        setDoctorReviewNote("");
        setNotice(`Doctor verification ${decision}.`);
        setRefreshKey((key) => key + 1);
        await loadDoctorDetails(userId);
      } catch (requestError) {
        setError(getApiMessage(requestError, "Unable to update doctor verification."));
      }
  }

  async function changeDoctorStatus(doctor: Doctor) {
      const status = doctor.status === "active" ? "disabled" : "active";
      setError("");
      try {
        await setDoctorStatus(doctor._id, status);
        setRefreshKey((key) => key + 1);
      } catch (requestError) {
        setError(getApiMessage(requestError, "Unable to update doctor account."));
      }
  }

  async function downloadDoctorDocument(userId: string, document: NonNullable<DoctorDetails["profile"]>["documents"][number]) {
      setError("");
      try {
        const { data } = await getDoctorDocument(userId, document.id);
        const url = URL.createObjectURL(data as Blob);
        const link = window.document.createElement("a");
        link.href = url;
        link.download = document.downloadName ?? document.originalName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (requestError) {
        setError(getApiMessage(requestError, "Unable to download this professional document."));
    }
  }

  return <>
    <SimulationBanner />
    <main className="mx-auto max-w-6xl px-4 pb-10 pt-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">Admin operations</h1></div>
        <div className="flex gap-2"><LanguageSwitcher /><button className="rounded-lg border px-3" type="button" onClick={async () => { await logout(); navigate("/login"); }}>Logout</button></div>
      </header>
      <nav className="my-6 flex flex-wrap gap-2" aria-label="Admin sections">
        {user?.role === "system_admin" && <button className={`min-h-touch rounded-xl px-4 font-bold ${tab === "overview" ? "bg-medical-700 text-white" : "border"}`} type="button" onClick={() => setTab("overview")}>{t("phase4.adminOverview")}</button>}
        <button className={`min-h-touch rounded-xl px-4 font-bold ${tab === "hospitals" ? "bg-medical-700 text-white" : "border"}`} type="button" onClick={() => setTab("hospitals")}>Hospitals</button>
        <button className={`min-h-touch rounded-xl px-4 font-bold ${tab === "doctors" ? "bg-medical-700 text-white" : "border"}`} type="button" onClick={() => setTab("doctors")}>Doctors</button>
        {user?.role === "system_admin" && <button className={`min-h-touch rounded-xl px-4 font-bold ${tab === "managers" ? "bg-medical-700 text-white" : "border"}`} type="button" onClick={() => setTab("managers")}>Hospital managers</button>}
        {user?.role === "system_admin" && <button className={`min-h-touch rounded-xl px-4 font-bold ${tab === "asha" ? "bg-medical-700 text-white" : "border"}`} type="button" onClick={() => setTab("asha")}>ASHA workers</button>}
        <button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => navigate("/admin/dashboard")}>District dashboard</button>
        <button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => navigate("/analytics")}>{t("phase8.title")}</button>
        <button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => navigate("/admin/navigator")}>Mandal Navigator</button>
        <button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => navigate("/admin/audit")}>Audit logs</button>
      </nav>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-green-50 p-3 text-green-900" role="status">{notice}</p>}
      {tab === "overview" && user?.role === "system_admin" ? <AdminOverview /> : tab === "managers" ? <HospitalManagerAdmin /> : tab === "asha" && user?.role === "system_admin" ? <AshaWorkerAdmin /> : tab === "hospitals" ? <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {user?.role === "system_admin" && <HospitalForm initial={editing} onSaved={() => { setEditing(undefined); setRefreshKey((key) => key + 1); }} />}
        <section>
          <label className="mb-3 block font-semibold">Search hospitals<input className="mt-1 w-full rounded-lg border p-3" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="space-y-3">{hospitals.map((hospital) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm" key={hospital._id}>
            <div><h2 className="font-bold">{hospital.name}</h2><p className="text-sm text-slate-600">{(hospital.ownershipType ?? (["private", "Private"].includes(hospital.type) ? "private" : "government")) === "private" ? "Private Hospital" : "Government Hospital"} · {hospital.type} · {hospital.districtName ?? "District not set"}{hospital.mandalName ? ` · ${hospital.mandalName}` : ""} · {hospital.address ?? "No address"} · {hospital.active ? "Active" : "Inactive"}</p><p className="text-sm text-slate-600">Doctors working: {hospital.activeDoctorCount ?? 0} · Total assigned: {hospital.doctorCount ?? 0}</p></div>
            {user?.role === "system_admin" && <div className="flex gap-2"><button className="min-h-touch rounded-lg border px-4" type="button" onClick={() => setEditing(hospital)}>Edit</button><button className="min-h-touch rounded-lg border px-4" type="button" onClick={() => void toggleHospital(hospital)}>{hospital.active ? "Deactivate" : "Activate"}</button></div>}
          </article>)}
            {hospitals.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600">No hospitals found.</p>}
          </div>
        </section>
      </div> : <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {user?.role === "system_admin" && <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm lg:col-span-2" onSubmit={(event) => void assignDoctorProfile(event)}>
          <h2 className="text-xl font-bold">{t("phase4.assignDoctorProfile")}</h2>
          <p className="text-sm text-slate-600">{t("phase4.assignmentWarning")}</p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="block font-semibold">{t("phase4.doctor")}
              <select className="mt-1 w-full rounded-lg border p-3" required value={hospitalProfileForm.doctorId} onChange={(event) => setHospitalProfileForm({ ...hospitalProfileForm, doctorId: event.target.value })}>
                <option value="">{t("phase4.selectDoctor")}</option>
                {doctors.filter((doctor) => !doctor.hospitalProfile).map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name} · {doctor.username}</option>)}
              </select>
            </label>
            <label className="block font-semibold">{t("phase4.hospitalName")}
              <select className="mt-1 w-full rounded-lg border p-3" required value={hospitalProfileForm.hospitalId} onChange={(event) => setHospitalProfileForm({ ...hospitalProfileForm, hospitalId: event.target.value })}>
                <option value="">{t("phase4.selectHospital")}</option>
                {hospitals.filter((hospital) => hospital.active).map((hospital) => <option key={hospital._id} value={hospital._id}>{hospital.name} · {hospital.code}</option>)}
              </select>
            </label>
            <label className="block font-semibold">{t("phase4.registrationNo")}<input className="mt-1 w-full rounded-lg border p-3" maxLength={80} minLength={2} required value={hospitalProfileForm.registrationNo} onChange={(event) => setHospitalProfileForm({ ...hospitalProfileForm, registrationNo: event.target.value })} /></label>
            <label className="block font-semibold">{t("phase4.specialty")}<input className="mt-1 w-full rounded-lg border p-3" maxLength={120} minLength={2} required value={hospitalProfileForm.specialty} onChange={(event) => setHospitalProfileForm({ ...hospitalProfileForm, specialty: event.target.value })} /></label>
          </div>
          {doctors.every((doctor) => doctor.hospitalProfile) && <p className="text-sm text-slate-600">{t("phase4.noUnassignedDoctors")}</p>}
          <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" disabled={busy || doctors.every((doctor) => doctor.hospitalProfile) || hospitals.every((hospital) => !hospital.active)} type="submit">{busy ? t("phase4.saving") : t("phase4.assignDoctorProfile")}</button>
        </form>}
        <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void submitDoctor(event)}>
          <h2 className="text-xl font-bold">Create doctor account</h2>
          <label className="block font-semibold">Username<input autoComplete="username" className="mt-1 w-full rounded-lg border p-3" minLength={3} maxLength={50} required value={doctorForm.username} onChange={(event) => setDoctorForm({ ...doctorForm, username: event.target.value })} /></label>
          <label className="block font-semibold">Email<input autoComplete="email" className="mt-1 w-full rounded-lg border p-3" type="email" required value={doctorForm.email} onChange={(event) => setDoctorForm({ ...doctorForm, email: event.target.value })} /></label>
          <label className="block font-semibold">Phone number<input autoComplete="tel" className="mt-1 w-full rounded-lg border p-3" type="tel" minLength={7} required value={doctorForm.phone} onChange={(event) => setDoctorForm({ ...doctorForm, phone: event.target.value })} /></label>
          <label className="block font-semibold">Temporary password<input autoComplete="new-password" className="mt-1 w-full rounded-lg border p-3" type="password" minLength={8} required value={doctorForm.password} onChange={(event) => setDoctorForm({ ...doctorForm, password: event.target.value })} /></label>
          <label className="block font-semibold">Assigned mandal (optional)<select className="mt-1 w-full rounded-lg border p-3" value={doctorForm.mandalId} onChange={(event) => setDoctorForm({ ...doctorForm, mandalId: event.target.value })}><option value="">No patient assignment yet</option>{mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{mandal.name_en ?? mandal.name}</option>)}</select></label>
          <p className="text-sm text-slate-600">Doctors sign in with their username, email, or phone. Multi-factor setup is required on first sign-in. Patient records are visible only for assigned care areas.</p>
          <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" disabled={busy} type="submit">{busy ? "Creating..." : "Create doctor"}</button>
        </form>
        <section>
          <label className="mb-3 block font-semibold">Search doctors<input className="mt-1 w-full rounded-lg border p-3" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="mb-3 block font-semibold">Verification status<select className="mt-1 w-full rounded-lg border p-3" value={doctorVerificationFilter} onChange={(event) => setDoctorVerificationFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option></select></label>
          {doctorStats && <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{Object.entries(doctorStats).map(([label, count]) => <p key={label} className="rounded-lg bg-white p-3"><span className="font-bold">{count}</span> {label}</p>)}</div>}
          <div className="space-y-3">{doctors.map((doctor) => <article className="rounded-xl bg-white p-4 shadow-sm" key={doctor._id}>
            <h2 className="font-bold">{doctor.name} · {doctor.username}</h2><p className="text-sm text-slate-600">{doctor.email} · {doctor.phone}</p><p className="text-sm text-slate-600">Account: {doctor.status} · Verification: {doctor.hospitalProfile?.verificationStatus ?? "draft"}</p>
            <p className="text-sm text-slate-600">{t("phase4.assignedHospital")}: {doctor.hospitalProfile?.hospital?.name ?? t("phase4.notAssigned")} · Documents: {doctor.hospitalProfile?.documentCount ?? 0}</p>
            <div className="mt-3 flex flex-wrap items-end gap-2"><label className="flex-1 font-semibold">Assigned mandal<select className="mt-1 min-h-touch w-full rounded-lg border px-3" value={doctorMandals[doctor._id] ?? ""} onChange={(event) => setDoctorMandals((current) => ({ ...current, [doctor._id]: event.target.value }))}><option value="">No patient assignment</option>{mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{mandal.name_en ?? mandal.name}</option>)}</select></label><button className="min-h-touch rounded-lg border px-4 font-semibold" type="button" disabled={savingAssignment === doctor._id} onClick={() => void assignDoctor(doctor._id)}>{savingAssignment === doctor._id ? "Saving..." : "Save assignment"}</button><button className="min-h-touch rounded-lg border px-4 font-semibold" type="button" onClick={() => void loadDoctorDetails(doctor._id)}>Profile and documents</button>
              {user?.role === "system_admin" && <button className="min-h-touch rounded-lg border px-4 font-semibold" type="button" onClick={() => void changeDoctorStatus(doctor)}>{doctor.status === "active" ? "Disable account" : "Enable account"}</button>}
            </div>
            {user?.role === "system_admin" && doctor.hospitalProfile?.verificationStatus === "pending" && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-60 flex-1 font-semibold">Review note<input className="mt-1 min-h-touch w-full rounded-lg border px-3" maxLength={1000} value={doctorReviewNote} onChange={(event) => setDoctorReviewNote(event.target.value)} placeholder="Required for rejection" /></label><button className="min-h-touch rounded-lg bg-green-700 px-4 font-bold text-white" type="button" onClick={() => void reviewDoctor(doctor._id, "verified")}>Verify</button><button className="min-h-touch rounded-lg bg-red-700 px-4 font-bold text-white" type="button" disabled={!doctorReviewNote.trim()} onClick={() => void reviewDoctor(doctor._id, "rejected")}>Reject</button></div>}
            {user?.role === "system_admin" && doctor.hospitalProfile?.verificationStatus === "verified" && <button className="mt-3 min-h-touch rounded-lg border px-4 font-semibold" type="button" onClick={() => void reviewDoctor(doctor._id, "suspended")}>Suspend verification</button>}
          </article>)}
            {doctors.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600">No doctor accounts found.</p>}
          </div>
          {doctorDetailLoading && <p className="mt-4" role="status">Loading doctor profile…</p>}
          {doctorDetails && <section className="mt-4 rounded-xl border bg-white p-4" aria-label="Doctor details">
            <div className="flex justify-between gap-2"><h2 className="font-bold">{doctorDetails.doctor.name} — {doctorDetails.profile?.verificationStatus ?? "No profile"}</h2><button className="rounded-lg border px-3" type="button" onClick={() => setDoctorDetails(null)}>Close</button></div>
            {doctorDetails.profile ? <><p className="mt-2 text-sm">{doctorDetails.profile.specialty ?? "Specialty not entered"} · {doctorDetails.profile.registrationNo ?? "Registration not entered"} · {doctorDetails.profile.hospital?.name ?? "No hospital assignment"}</p><ul className="mt-3 space-y-2">{doctorDetails.profile.documents.map((document) => <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2" key={document.id}><div><p>{t(`phase5.${document.type === "registration_certificate" ? "registrationCertificate" : document.type === "qualification" ? "qualificationDocument" : document.type === "experience_certificate" ? "experienceCertificate" : document.type === "identity" ? "identityDocument" : "otherDocument"}`)} · {document.reviewStatus === "accepted" ? "approved" : document.reviewStatus} · {document.originalName}</p><p className="text-xs text-slate-600">Uploaded {new Date(document.uploadedAt).toLocaleString()}{document.verifiedAt ? ` · Verified ${new Date(document.verifiedAt).toLocaleString()}` : ""}{document.adminRemarks ? ` · ${document.adminRemarks}` : ""}</p><p className="text-xs text-slate-500">ID: {document.id}</p></div><button className="rounded-lg border px-3 py-1" type="button" onClick={() => void downloadDoctorDocument(doctorDetails.doctor._id, document)}>Download</button></li>)}</ul>{doctorDetails.profile.verificationHistory.map((event, index) => <p className="mt-2 text-sm text-slate-600" key={`${event.status}-${event.createdAt}-${index}`}>{event.status} · {event.note ?? "No note"} · {new Date(event.createdAt).toLocaleString()}</p>)}</> : <p className="mt-2">Doctor has not created a profile yet.</p>}
          </section>}
        </section>
      </div>}
    </main>
  </>;
}
