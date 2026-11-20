import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "../auth/api";

type DoctorDocument = { id: string; type: string; originalName: string; downloadName?: string; size: number; reviewStatus: string; adminRemarks?: string; uploadedAt: string; verifiedAt?: string };
type DoctorProfileData = {
  registrationNo?: string;
  registrationAuthority?: string;
  specialty?: string;
  qualification?: string;
  experienceYears?: number;
  professionalSummary?: string;
  verificationStatus: "draft" | "pending" | "verified" | "rejected" | "suspended";
  documents: DoctorDocument[];
};
type ProfileForm = Required<Pick<DoctorProfileData, "registrationNo" | "registrationAuthority" | "specialty" | "qualification" | "experienceYears" | "professionalSummary">>;

const blankForm: ProfileForm = { registrationNo: "", registrationAuthority: "", specialty: "", qualification: "", experienceYears: 0, professionalSummary: "" };

export default function DoctorProfile() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<DoctorProfileData | null>(null);
  const [form, setForm] = useState<ProfileForm>(blankForm);
  const [documentType, setDocumentType] = useState("registration_certificate");
  const [file, setFile] = useState<File>();
  const [uploadId, setUploadId] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadProfile() {
    setError("");
    const { data } = await api.get<{ profile: DoctorProfileData | null }>("/doctor-profile");
    setProfile(data.profile);
    setForm({
      registrationNo: data.profile?.registrationNo ?? "",
      registrationAuthority: data.profile?.registrationAuthority ?? "",
      specialty: data.profile?.specialty ?? "",
      qualification: data.profile?.qualification ?? "",
      experienceYears: data.profile?.experienceYears ?? 0,
      professionalSummary: data.profile?.professionalSummary ?? ""
    });
  }

  useEffect(() => {
    void loadProfile().catch((requestError: unknown) => setError(getApiMessage(requestError, "Unable to load your professional profile."))).finally(() => setLoading(false));
  }, []);

  const editable = !profile || profile.verificationStatus === "draft" || profile.verificationStatus === "rejected";
  const statusLabel = t(`phase5.${profile?.verificationStatus ?? "draft"}`);
  const hasDocument = (type: string) => profile?.documents.some((document) => document.type === type && document.reviewStatus !== "rejected") ?? false;
  const hasRegistrationCertificate = hasDocument("registration_certificate");
  const hasQualificationDocument = hasDocument("qualification");

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.patch<{ profile: DoctorProfileData }>("/doctor-profile", form);
      setProfile(data.profile);
      setNotice(t("phase5.saved"));
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to save your profile."));
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = new FormData();
      data.append("type", documentType);
      data.append("uploadId", uploadId);
      data.append("file", file);
      await api.post("/doctor-profile/documents", data);
      setFile(undefined);
      setUploadId("");
      setFileInputKey((key) => key + 1);
      await loadProfile();
      setNotice(t("phase5.documentUploaded"));
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to upload your document."));
    } finally {
      setBusy(false);
    }
  }

  async function submitVerification() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.post<{ profile: DoctorProfileData }>("/doctor-profile/submit");
      setProfile(data.profile);
      setNotice(t("phase5.submitted"));
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to submit your profile for verification."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadDocument(document: DoctorDocument) {
    setError("");
    try {
      const { data } = await api.get(`/doctor-profile/documents/${document.id}`, { responseType: "blob" });
      const url = URL.createObjectURL(data as Blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.downloadName ?? document.originalName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to download your document."));
    }
  }

  return <><SimulationBanner /><main className="mx-auto max-w-4xl px-4 pb-10 pt-24">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{t("phase5.profile")}</h1></div><div className="flex items-center gap-3"><LanguageSwitcher /><Link className="rounded-lg border px-3 py-2 font-semibold" to="/doctor">{t("phase5.dashboard")}</Link></div></header>
    <p className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">{t("phase5.notForClinicalUse")}</p>
    {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
    {notice && <p className="mb-4 rounded-lg bg-green-50 p-3 text-green-900" role="status">{notice}</p>}
    {loading ? <p role="status">Loading…</p> : <>
      <section className="mb-5 rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">{t("phase5.status")}: {statusLabel}</h2><p className="mt-2 text-sm text-slate-600">{t("phase5.requiredDocuments")}</p></section>
      <section className="mb-5 rounded-2xl bg-white p-5 shadow-sm" aria-live="polite">
        <h2 className="font-bold">{t("phase5.documentChecklist")}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>{t("phase5.registrationCertificate")}: {t(hasRegistrationCertificate ? "phase5.provided" : "phase5.missing")}</li>
          <li>{t("phase5.qualificationDocument")}: {t(hasQualificationDocument ? "phase5.provided" : "phase5.missing")}</li>
        </ul>
        {editable && (!hasRegistrationCertificate || !hasQualificationDocument) && <button className="mt-3 rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => window.document.getElementById("doctor-document-upload")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{t("phase5.goToDocumentUpload")}</button>}
      </section>
      <form className="grid gap-4 rounded-2xl bg-white p-5 shadow-sm sm:grid-cols-2" onSubmit={(event) => void saveProfile(event)}>
        <label className="font-semibold">{t("phase5.registrationNo")}<input className="mt-1 min-h-touch w-full rounded-lg border p-3" maxLength={80} required disabled={!editable} value={form.registrationNo} onChange={(event) => setForm({ ...form, registrationNo: event.target.value })} /></label>
        <label className="font-semibold">{t("phase5.registrationAuthority")}<input className="mt-1 min-h-touch w-full rounded-lg border p-3" maxLength={160} required disabled={!editable} value={form.registrationAuthority} onChange={(event) => setForm({ ...form, registrationAuthority: event.target.value })} /></label>
        <label className="font-semibold">{t("phase5.specialty")}<input className="mt-1 min-h-touch w-full rounded-lg border p-3" maxLength={120} required disabled={!editable} value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} /></label>
        <label className="font-semibold">{t("phase5.qualification")}<input className="mt-1 min-h-touch w-full rounded-lg border p-3" maxLength={200} required disabled={!editable} value={form.qualification} onChange={(event) => setForm({ ...form, qualification: event.target.value })} /></label>
        <label className="font-semibold">{t("phase5.experienceYears")}<input className="mt-1 min-h-touch w-full rounded-lg border p-3" type="number" min={0} max={70} required disabled={!editable} value={form.experienceYears} onChange={(event) => setForm({ ...form, experienceYears: Number(event.target.value) })} /></label>
        <label className="font-semibold sm:col-span-2">{t("phase5.professionalSummary")}<textarea className="mt-1 min-h-24 w-full rounded-lg border p-3" maxLength={2000} disabled={!editable} value={form.professionalSummary} onChange={(event) => setForm({ ...form, professionalSummary: event.target.value })} /></label>
        {editable && <button className="primary min-h-touch sm:col-span-2" disabled={busy} type="submit">{t("phase5.saveProfile")}</button>}
      </form>
      <section id="doctor-document-upload" className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">{t("phase5.uploadDocument")}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]" onSubmit={(event) => void uploadDocument(event)}>
          <label className="font-semibold">{t("phase5.uploadType")}<select className="mt-1 min-h-touch w-full rounded-lg border p-3" disabled={!editable} value={documentType} onChange={(event) => { setDocumentType(event.target.value); if (file) setUploadId(window.crypto.randomUUID()); }}><option value="registration_certificate">{t("phase5.registrationCertificate")}</option><option value="qualification">{t("phase5.qualificationDocument")}</option><option value="experience_certificate">{t("phase5.experienceCertificate")}</option><option value="identity">{t("phase5.identityDocument")}</option><option value="other">{t("phase5.otherDocument")}</option></select></label>
          <label className="font-semibold">{t("phase5.chooseFile")}<input key={fileInputKey} className="mt-1 min-h-touch w-full rounded-lg border p-2" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={!editable} onChange={(event) => { const selectedFile = event.target.files?.[0]; setFile(selectedFile); setUploadId(selectedFile ? window.crypto.randomUUID() : ""); }} required type="file" /></label>
          <button className="min-h-touch self-end rounded-xl border px-4 font-bold disabled:opacity-50" disabled={!profile || !editable || !file || busy} type="submit">{t("phase5.uploadDocument")}</button>
        </form>
        <ul className="mt-4 space-y-2">{(profile?.documents ?? []).map((document) => <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3" key={document.id}><div><p className="font-semibold">{t(`phase5.${document.type === "registration_certificate" ? "registrationCertificate" : document.type === "qualification" ? "qualificationDocument" : document.type === "experience_certificate" ? "experienceCertificate" : document.type === "identity" ? "identityDocument" : "otherDocument"}`)} · {t(`phase5.${document.reviewStatus === "accepted" ? "approved" : document.reviewStatus === "rejected" ? "rejectedDocumentStatus" : document.reviewStatus}`)}</p><p className="text-sm text-slate-600">{document.originalName} · {new Date(document.uploadedAt).toLocaleString()}{document.verifiedAt ? ` · ${t("phase5.verifiedAt")} ${new Date(document.verifiedAt).toLocaleString()}` : ""}</p><p className="text-xs text-slate-500">{t("phase5.documentId")}: {document.id}</p>{document.reviewStatus === "rejected" && document.adminRemarks && <p className="mt-1 text-sm text-red-800">{t("phase5.rejectionReason")}: {document.adminRemarks}</p>}</div><button className="rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void downloadDocument(document)}>Download</button></li>)}</ul>
        {profile && editable && <button className="primary mt-5 min-h-touch w-full" disabled={busy} type="button" onClick={() => void submitVerification()}>{t("phase5.submitVerification")}</button>}
      </section>
    </>}
  </main></>;
}
