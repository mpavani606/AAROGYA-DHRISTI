import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { getPatientRecords, getRecordSignedUrl, type PatientRecord } from "../patient/patientApi";

type CaseItem = { _id: string; status: string; priorityBand?: string; riskScore?: number; updatedAt?: string; patient?: { _id?: string; patientCode?: string } };
type PatientItem = { _id: string; name: string; phone?: string };
type PatientPrescription = { _id: string; medicineName: string; dosage: string; doctor?: string; prescriptionDate: string; notes?: string; source?: string };
type ReviewChoice = "agree" | "disagree" | "defer";
type VerificationStatus = "draft" | "pending" | "verified" | "rejected" | "suspended";
type CaseCare = {
  referrals: Array<{ id: string; reference: string; specialty: string; destination?: { name?: string }; status: string; caseId: string }>;
  appointments: Array<{ id: string; caseId?: string; hospital?: { name?: string }; startAt: string; endAt: string; status: string; tokenNo?: string }>;
};
type ClinicalSummary = {
  case: { notes: string; workflowPriority: string | null; status: string };
  patientHistory: {
    association: string;
    symptoms: Array<{ name: string; severity?: string; durationDays?: number }>;
    habits: Array<{ name: string; frequency?: string; quantity?: number; unit?: string }>;
  };
  recordedRiskIndicators: { score: number | null; factors: Array<{ rule: string; evidence?: string }>; disclaimer: string };
  imageHistory: Array<{ qualityStatus: string; uploadedAt: string }>;
  doctorAssessment: { status: string; decision?: string; reason?: string; findings?: string };
  aiSummary: { status: string; aiGenerated: false };
  disclaimer: string;
};
type CaseImageItem = {
  id: string;
  qualityStatus: string;
  createdAt: string;
  aiResult: {
    status: string;
    clinicallyValidated: boolean;
    model?: { name?: string; version?: string };
    processedAt: string;
  } | null;
  geminiObservation?: {
    imageQuality: "adequate" | "limited" | "uncertain";
    visibleDescription: string;
    model: string;
    processedAt: string;
  } | null;
  imageUrl?: string;
};
type ReferralDestination = { _id: string; name: string; specialties?: string[]; services?: string[] };
type AssignedFollowUp = { id: string; patient?: { patientCode?: string }; scheduledAt: string; status: string; overdue: boolean };
type InvestigationItem = {
  _id: string;
  type: "biopsy" | "histopathology" | "ct" | "mri";
  status: "advised" | "scheduled" | "collected" | "report_received" | "reviewed" | "cancelled";
  reports: Array<{ _id: string; summary: string; reviewedAt?: string; createdAt: string }>;
};
type DoctorIdentityProfile = {
  specialty?: string;
  hospitalName?: string;
  hospital?: string | { name?: string };
};

export default function DoctorPortal() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const routedPatientId = searchParams.get("patientId");
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selected, setSelected] = useState<CaseItem | null>(null);
  const [decision, setDecision] = useState<ReviewChoice>("agree");
  const [reason, setReason] = useState("");
  const [findings, setFindings] = useState("");
  const [message, setMessage] = useState("");
  const [caseImages, setCaseImages] = useState<CaseImageItem[]>([]);
  const [caseImagesLoading, setCaseImagesLoading] = useState(false);
  const [caseImagesError, setCaseImagesError] = useState("");
  const [caseCare, setCaseCare] = useState<CaseCare>();
  const [caseCareLoading, setCaseCareLoading] = useState(false);
  const [clinicalSummary, setClinicalSummary] = useState<ClinicalSummary>();
  const [clinicalSummaryLoading, setClinicalSummaryLoading] = useState(false);
  const [clinicalSummaryError, setClinicalSummaryError] = useState("");
  const [destinations, setDestinations] = useState<ReferralDestination[]>([]);
  const [followUps, setFollowUps] = useState<AssignedFollowUp[]>([]);
  const [destinationId, setDestinationId] = useState("");
  const [referralSpecialty, setReferralSpecialty] = useState("");
  const [referralPriority, setReferralPriority] = useState<"routine" | "urgent">("routine");
  const [referralReason, setReferralReason] = useState("");
  const [referralAppointmentDetails, setReferralAppointmentDetails] = useState<Record<string, string>>({});
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [careBusy, setCareBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<PatientItem[]>([]);
  const [patientError, setPatientError] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientItem | null>(null);
  const [patientRecords, setPatientRecords] = useState<PatientRecord[]>([]);
  const [patientPrescriptions, setPatientPrescriptions] = useState<PatientPrescription[]>([]);
  const [prescriptionForm, setPrescriptionForm] = useState({ medicineName: "", dosage: "", prescriptionDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [prescriptionBusy, setPrescriptionBusy] = useState(false);
  const [recordUrls, setRecordUrls] = useState<Record<string, string>>({});
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [investigations, setInvestigations] = useState<InvestigationItem[]>([]);
  const [investigationType, setInvestigationType] = useState<InvestigationItem["type"]>("biopsy");
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [investigationError, setInvestigationError] = useState("");
  const [investigationBusy, setInvestigationBusy] = useState(false);
  const [reportSummaries, setReportSummaries] = useState<Record<string, string>>({});
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>();
  const [doctorProfile, setDoctorProfile] = useState<DoctorIdentityProfile | null>(null);
  const selectedCaseId = selected?._id;

  async function loadQueue() {
    setLoading(true);
    try {
      const { data: profileData } = await api.get("/doctor-profile");
      setDoctorProfile(profileData.profile ?? null);
      const status = (profileData.profile?.verificationStatus ?? "draft") as VerificationStatus;
      setVerificationStatus(status);
      if (status !== "verified") { setCases([]); return; }
      const { data } = await api.get("/review/queue");
      setCases(data.cases);
    } catch (error) { setMessage(getApiMessage(error, "Unable to load queue.")); } finally { setLoading(false); }
  }
  useEffect(() => { void loadQueue(); }, []);
  useEffect(() => {
    if (verificationStatus !== "verified") return;
    let active = true;
    void api.get<{ destinations: ReferralDestination[] }>("/referral-destinations").then(({ data }) => {
      if (active) setDestinations(data.destinations);
    }).catch((error: unknown) => {
      if (active) setMessage(getApiMessage(error, t("phase7.destinationsError")));
    });
    void api.get<{ followUps: AssignedFollowUp[] }>("/follow-ups/assigned").then(({ data }) => {
      if (active) setFollowUps(data.followUps);
    }).catch((error: unknown) => {
      if (active) setMessage(getApiMessage(error, t("phase7.careError")));
    });
    return () => { active = false; };
  }, [verificationStatus, t]);
  useEffect(() => {
    if (!selectedCaseId) {
      setCaseImages([]);
      setCaseImagesError("");
      setCaseCare(undefined);
      setCaseCareLoading(false);
      setClinicalSummary(undefined);
      setClinicalSummaryLoading(false);
      setClinicalSummaryError("");
      return;
    }
    let active = true;
    const objectUrls: string[] = [];
    setCaseImages([]);
    setCaseImagesLoading(true);
    setCaseImagesError("");
    setCaseCare(undefined);
    setCaseCareLoading(true);
    setClinicalSummary(undefined);
    setClinicalSummaryError("");
    setClinicalSummaryLoading(true);
    void api.get<CaseCare>(`/cases/${selectedCaseId}/care-overview`).then(({ data }) => {
      if (active) setCaseCare(data);
    }).catch((error: unknown) => {
      if (active) setMessage(getApiMessage(error, t("phase7.careError")));
    }).finally(() => { if (active) setCaseCareLoading(false); });
    void api.get<{ summary: ClinicalSummary }>(`/cases/${selectedCaseId}/clinical-summary`).then(({ data }) => {
      if (active) setClinicalSummary(data.summary);
    }).catch((error: unknown) => {
      if (active) setClinicalSummaryError(getApiMessage(error, t("phase7.summaryError")));
    }).finally(() => { if (active) setClinicalSummaryLoading(false); });
    void api.get<{ images: Omit<CaseImageItem, "imageUrl">[] }>(`/cases/${selectedCaseId}/images`).then(async ({ data }) => {
      const images = await Promise.all(data.images.map(async (image) => {
        const { data: blob } = await api.get<Blob>(`/cases/${selectedCaseId}/images/${image.id}`, { responseType: "blob" });
        const imageUrl = URL.createObjectURL(blob);
        objectUrls.push(imageUrl);
        return { ...image, imageUrl };
      }));
      if (active) setCaseImages(images);
      else objectUrls.forEach(URL.revokeObjectURL);
    }).catch((error: unknown) => {
      if (active) setCaseImagesError(getApiMessage(error, t("phase7.imagesError")));
    }).finally(() => { if (active) setCaseImagesLoading(false); });
    return () => { active = false; objectUrls.forEach(URL.revokeObjectURL); };
  }, [selectedCaseId, t]);
  useEffect(() => {
    if (!selectedCaseId) {
      setInvestigations([]);
      setInvestigationError("");
      setInvestigationLoading(false);
      return;
    }
    let active = true;
    setInvestigationLoading(true);
    setInvestigationError("");
    void api.get<{ investigations: InvestigationItem[] }>(`/cases/${selectedCaseId}/investigations`).then(({ data }) => {
      if (active) setInvestigations(data.investigations);
    }).catch((requestError: unknown) => {
      if (active) setInvestigationError(getApiMessage(requestError, "Unable to load diagnostic tests."));
    }).finally(() => { if (active) setInvestigationLoading(false); });
    return () => { active = false; };
  }, [selectedCaseId]);
  useEffect(() => {
    if (verificationStatus !== "verified") return;
    let active = true;
    setPatientError("");
    void api.get("/patients", { params: patientSearch ? { search: patientSearch } : {} }).then(({ data }) => {
      if (active) setPatients(data.patients as PatientItem[]);
    }).catch((error: unknown) => {
      if (active) setPatientError(getApiMessage(error, "Unable to load assigned patients."));
    });
    return () => { active = false; };
  }, [patientSearch, verificationStatus]);

  useEffect(() => {
    if (!routedPatientId || verificationStatus !== "verified") return;
    let active = true;
    const listedPatient = patients.find((patient) => patient._id === routedPatientId);
    if (listedPatient) {
      void openPatientHistory(listedPatient);
      return () => { active = false; };
    }
    void api.get<{ patient: PatientItem }>(`/patients/${encodeURIComponent(routedPatientId)}`).then(({ data }) => {
      if (active) void openPatientHistory(data.patient);
    }).catch((requestError: unknown) => {
      if (active) setPatientError(getApiMessage(requestError, "Unable to open this assigned patient."));
    });
    return () => { active = false; };
  }, [patients, routedPatientId, verificationStatus]);

  async function openPatientHistory(patient: PatientItem) {
    setSelectedPatient(patient);
    setRecordsLoading(true);
    setPatientError("");
    setPatientRecords([]);
    setPatientPrescriptions([]);
    setRecordUrls({});
    try {
      const [records, prescriptionsResponse] = await Promise.all([
        getPatientRecords(patient._id),
        api.get<{ prescriptions: PatientPrescription[] }>(`/patients/${patient._id}/prescriptions`)
      ]);
      const mediaIds = [...new Set(records.flatMap((record) => record.media))];
      const urls = await Promise.all(mediaIds.map(async (mediaId) => [mediaId, await getRecordSignedUrl(patient._id, mediaId)] as const));
      setPatientRecords(records);
      setPatientPrescriptions(prescriptionsResponse.data.prescriptions);
      setRecordUrls(Object.fromEntries(urls));
    } catch (error) {
      setPatientError(getApiMessage(error, "Unable to load this patient's medical records."));
    } finally {
      setRecordsLoading(false);
    }
  }

  async function loadInvestigations(caseId: string) {
    setInvestigationLoading(true);
    setInvestigationError("");
    try {
      const { data } = await api.get<{ investigations: InvestigationItem[] }>(`/cases/${caseId}/investigations`);
      setInvestigations(data.investigations);
    } catch (requestError) {
      setInvestigationError(getApiMessage(requestError, "Unable to load diagnostic tests."));
    } finally {
      setInvestigationLoading(false);
    }
  }

  async function issuePrescription(event: FormEvent) {
    event.preventDefault();
    if (!selectedPatient) return;
    setPrescriptionBusy(true);
    setPatientError("");
    setMessage("");
    try {
      await api.post(`/patients/${selectedPatient._id}/prescriptions`, prescriptionForm);
      const { data } = await api.get<{ prescriptions: PatientPrescription[] }>(`/patients/${selectedPatient._id}/prescriptions`);
      setPatientPrescriptions(data.prescriptions);
      setPrescriptionForm({ medicineName: "", dosage: "", prescriptionDate: new Date().toISOString().slice(0, 10), notes: "" });
      setMessage("Prescription saved.");
    } catch (requestError) {
      setPatientError(getApiMessage(requestError, "Unable to save the prescription."));
    } finally {
      setPrescriptionBusy(false);
    }
  }

  async function createInvestigation(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setInvestigationBusy(true);
    setInvestigationError("");
    setMessage("");
    try {
      await api.post(`/cases/${selected._id}/investigations`, { type: investigationType });
      await loadInvestigations(selected._id);
      setMessage("Diagnostic test added.");
    } catch (requestError) {
      setInvestigationError(getApiMessage(requestError, "Unable to add this diagnostic test."));
    } finally {
      setInvestigationBusy(false);
    }
  }

  async function updateInvestigationStatus(item: InvestigationItem, status: "scheduled" | "collected" | "reviewed" | "cancelled") {
    setInvestigationBusy(true);
    setInvestigationError("");
    try {
      await api.patch(`/investigations/${item._id}/status`, { status });
      if (selected) await loadInvestigations(selected._id);
      setMessage("Diagnostic test updated.");
    } catch (requestError) {
      setInvestigationError(getApiMessage(requestError, "Unable to update this diagnostic test."));
    } finally {
      setInvestigationBusy(false);
    }
  }

  async function saveInvestigationReport(event: FormEvent, item: InvestigationItem) {
    event.preventDefault();
    const summary = reportSummaries[item._id]?.trim() ?? "";
    if (summary.length < 3) {
      setInvestigationError("Enter a report summary of at least 3 characters.");
      return;
    }
    setInvestigationBusy(true);
    setInvestigationError("");
    try {
      await api.post(`/investigations/${item._id}/report`, { summary });
      setReportSummaries((current) => ({ ...current, [item._id]: "" }));
      if (selected) await loadInvestigations(selected._id);
      setMessage("Diagnostic report saved.");
    } catch (requestError) {
      setInvestigationError(getApiMessage(requestError, "Unable to save the diagnostic report."));
    } finally {
      setInvestigationBusy(false);
    }
  }

  async function submitReview() {
    if (!selected || reason.trim().length < 3) { setMessage("A reason is required / కారణం అవసరం / कारण आवश्यक है"); return; }
    if (!window.confirm(t("phase7.confirmReview"))) return;
    try {
      const { data } = await api.post<{ review: { _id: string } }>(`/cases/${selected._id}/review`, { decision, reason, findings, aiAgreement: decision === "defer" ? "not_applicable" : decision });
      await api.post(`/cases/${selected._id}/sign`, { reviewId: data.review._id });
      setMessage("Review saved / సమీక్ష భద్రపరచబడింది / समीक्षा सहेजी गई"); setReason(""); setFindings(""); await loadQueue();
    } catch (error) { setMessage(getApiMessage(error, "Unable to save review.")); }
  }

  async function requestRecapture() {
    if (!selected || !window.confirm(t("phase7.requestRecapture"))) return;
    try {
      await api.post(`/cases/${selected._id}/recapture-request`);
      setMessage(t("phase7.requestRecapture"));
      await loadQueue();
    } catch (error) { setMessage(getApiMessage(error, "Unable to request a new image.")); }
  }

  async function createReferral(event: FormEvent) {
    event.preventDefault();
    if (!selected || !destinationId || !referralSpecialty.trim() || referralReason.trim().length < 3) {
      setMessage(t("phase7.missingDestination"));
      return;
    }
    if (!window.confirm(t("phase7.confirmReferral"))) return;
    setCareBusy(true);
    try {
      await api.post(`/cases/${selected._id}/referrals`, { hospital: destinationId, toSpecialty: referralSpecialty, priority: referralPriority, reason: referralReason });
      setMessage(t("phase7.createReferral"));
      setReferralReason("");
      await loadQueue();
    } catch (error) { setMessage(getApiMessage(error, t("phase7.careError"))); }
    finally { setCareBusy(false); }
  }

  async function updateReferralStatus(referralId: string, status: "accepted" | "scheduled" | "completed", appointmentDetails?: string) {
    if (!selected) return;
    try {
      await api.patch(`/referrals/${referralId}/status`, { status, ...(appointmentDetails ? { appointmentDetails } : {}) });
      const { data } = await api.get<CaseCare>(`/cases/${selected._id}/care-overview`);
      setCaseCare(data);
      setReferralAppointmentDetails((current) => ({ ...current, [referralId]: "" }));
      setMessage("Referral updated.");
    } catch (error) { setMessage(getApiMessage(error, t("phase7.careError"))); }
  }

  async function createFollowUp(event: FormEvent) {
    event.preventDefault();
    if (!selected || !followUpAt || new Date(followUpAt) <= new Date()) {
      setMessage(t("phase7.missingFollowUpDate"));
      return;
    }
    if (!window.confirm(t("phase7.confirmFollowUp"))) return;
    setCareBusy(true);
    try {
      await api.post(`/cases/${selected._id}/follow-ups`, { scheduledAt: new Date(followUpAt).toISOString(), notes: followUpNotes });
      setFollowUpAt("");
      setFollowUpNotes("");
      const { data } = await api.get<{ followUps: AssignedFollowUp[] }>("/follow-ups/assigned");
      setFollowUps(data.followUps);
      setMessage(t("phase7.createFollowUp"));
    } catch (error) { setMessage(getApiMessage(error, t("phase7.careError"))); }
    finally { setCareBusy(false); }
  }

  async function updateFollowUpStatus(item: AssignedFollowUp, status: "completed" | "missed") {
    try {
      await api.patch(`/follow-ups/${item.id}`, { status });
      setFollowUps((current) => current.map((followUp) => followUp.id === item.id ? { ...followUp, status, overdue: false } : followUp));
      setMessage(status === "completed" ? t("phase7.completed") : t("phase7.missed"));
    } catch (error) { setMessage(getApiMessage(error, t("phase7.careError"))); }
  }

  async function downloadPatientReport() {
    if (!selectedPatient) return;
    try {
      const { data } = await api.get(`/patients/${selectedPatient._id}/medical-report`, { responseType: "blob" });
      const url = URL.createObjectURL(data as Blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "aarogya-drishti-simulation-report.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setPatientError(getApiMessage(error, t("phase7.reportError"))); }
  }

  return <><SimulationBanner /><main className="mx-auto max-w-6xl px-4 pb-12 pt-24">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">Doctor review / వైద్య సమీక్ష / डॉक्टर समीक्षा</h1><p className="mt-2 text-slate-700">Clinical decisions remain separate from demonstration AI output.</p></div>
      <div className="flex items-center gap-3"><LanguageSwitcher /><Link className="min-h-touch rounded-xl border px-4 py-2 font-bold" to="/appointments">Appointments</Link><Link className="min-h-touch rounded-xl border px-4 py-2 font-bold" to="/analytics">{t("phase8.title")}</Link><Link className="min-h-touch rounded-xl border px-4 py-2 font-bold" to="/doctor/profile">{t("phase5.profile")}</Link><Link className="min-h-touch rounded-xl border px-4 py-2 font-bold" to="/patient/login">Patient OTP sign-in</Link></div>
    </header>
    <section className="mt-5 grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-3" aria-label="Doctor account profile">
      <div><h2 className="font-bold">{user?.name}</h2><p className="text-sm text-slate-600">{user?.email}</p></div>
      <p><span className="font-semibold">{t("phase5.specialty")}:</span> {doctorProfile?.specialty ?? "—"}</p>
      <p><span className="font-semibold">{t("phase5.hospitalName")}:</span> {(typeof doctorProfile?.hospital === "object" ? doctorProfile.hospital?.name : undefined) ?? doctorProfile?.hospitalName ?? "Not assigned"}</p>
    </section>
    {verificationStatus && verificationStatus !== "verified" && <section className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4" role="status"><h2 className="font-bold">{t("phase5.status")}: {t(`phase5.${verificationStatus}`)}</h2><p className="mt-2 text-sm">{t("phase5.notForClinicalUse")}</p><Link className="mt-3 inline-flex font-bold text-medical-800 underline" to="/doctor/profile">{t("phase5.profile")}</Link></section>}
    {message && <p className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold" role="status">{message}</p>}
    <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div id="screening-review" className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Review queue / సమీక్ష క్యూ / समीक्षा कतार</h2><button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => void loadQueue()}>{t("refresh", "Refresh")}</button></div>
        {loading ? <p className="mt-5">Loading / లోడ్ అవుతోంది / लोड हो रहा है…</p> : <div className="mt-4 grid gap-3">{cases.map((item) => <button key={item._id} type="button" onClick={() => { setSelected(item); setDecision("agree"); setReason(""); setFindings(""); setDestinationId(""); setReferralSpecialty(""); setReferralPriority("routine"); setReferralReason(""); setFollowUpAt(""); setFollowUpNotes(""); }} className={`min-h-touch rounded-xl border p-4 text-left ${selected?._id === item._id ? "border-medical-700 bg-medical-50" : "border-slate-200"}`}><span className="font-bold">{item.patient?.patientCode ?? item._id}</span><span className="ml-3 rounded-full border px-2 py-1 text-xs font-bold">{item.priorityBand ?? "review"}</span><span className="mt-2 block text-sm text-slate-600">{item.status} · {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}</span></button>)}</div>}
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-sm">{selected ? <>
        <h2 className="text-xl font-bold">Case detail / కేసు వివరాలు / केस विवरण</h2>
        <p className="mt-2 text-slate-700">Patient code: {selected.patient?.patientCode ?? "Synthetic record"}</p>
        <section className="mt-5 rounded-xl border border-sky-300 bg-sky-50 p-4">
          <h3 className="font-bold">{t("phase7.clinicalSummary")}</h3>
          <p className="mt-2 text-sm">{t("phase7.summaryDisclaimer")}</p>
          {clinicalSummaryLoading ? <p className="mt-3" role="status">{t("phase7.summaryLoading")}</p>
            : clinicalSummaryError ? <p className="mt-3 text-sm text-rose-800" role="alert">{clinicalSummaryError}</p>
              : clinicalSummary ? <div className="mt-3 space-y-3 text-sm">
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold">{t("phase7.summaryAiUnavailable")}</p>
                <div><h4 className="font-bold">{t("phase7.summaryNotes")}</h4><p>{clinicalSummary.case.notes || t("phase7.summaryNoData")}</p></div>
                <div><h4 className="font-bold">{t("phase7.summarySymptoms")}</h4><p className="text-xs text-slate-600">{t("phase7.summaryNotCaseLinked")}</p>
                  {clinicalSummary.patientHistory.symptoms.length ? <ul className="list-disc pl-5">{clinicalSummary.patientHistory.symptoms.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}{item.severity ? ` · ${item.severity}` : ""}{item.durationDays !== undefined ? ` · ${item.durationDays} days` : ""}</li>)}</ul> : <p>{t("phase7.summaryNoData")}</p>}
                </div>
                <div><h4 className="font-bold">{t("phase7.summaryHabits")}</h4><p className="text-xs text-slate-600">{t("phase7.summaryNotCaseLinked")}</p>
                  {clinicalSummary.patientHistory.habits.length ? <ul className="list-disc pl-5">{clinicalSummary.patientHistory.habits.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}{item.frequency ? ` · ${item.frequency}` : ""}{item.quantity !== undefined ? ` · ${item.quantity} ${item.unit ?? ""}` : ""}</li>)}</ul> : <p>{t("phase7.summaryNoData")}</p>}
                </div>
                <div><h4 className="font-bold">{t("phase7.summaryRiskIndicators")}</h4><p>{clinicalSummary.recordedRiskIndicators.disclaimer}</p>
                  {clinicalSummary.recordedRiskIndicators.factors.length ? <ul className="list-disc pl-5">{clinicalSummary.recordedRiskIndicators.factors.map((item, index) => <li key={`${item.rule}-${index}`}>{item.evidence ?? item.rule}</li>)}</ul> : <p>{t("phase7.summaryNoData")}</p>}
                </div>
                <div><h4 className="font-bold">{t("phase7.summaryImages")}</h4>{clinicalSummary.imageHistory.length ? <ul className="list-disc pl-5">{clinicalSummary.imageHistory.map((item, index) => <li key={`${item.uploadedAt}-${index}`}>{item.qualityStatus} · {new Date(item.uploadedAt).toLocaleString()}</li>)}</ul> : <p>{t("phase7.summaryNoData")}</p>}</div>
                <div><h4 className="font-bold">{t("phase7.summaryDoctorAssessment")}</h4><p>{clinicalSummary.doctorAssessment.decision ?? clinicalSummary.doctorAssessment.status}{clinicalSummary.doctorAssessment.findings ? ` · ${clinicalSummary.doctorAssessment.findings}` : ""}</p></div>
              </div> : null}
        </section>
        <section className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="font-bold">{t("phase7.screeningHistory")}</h3>
          <p className="mt-2 text-sm">{t("phase7.screeningDisclaimer")}</p>
          {caseImagesLoading ? <p className="mt-3" role="status">{t("phase7.loadingCare")}</p> : caseImagesError ? <p className="mt-3 text-sm text-rose-800" role="alert">{caseImagesError}</p> : caseImages.length === 0 ? <p className="mt-3 text-sm">{t("phase7.noImages")}</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {caseImages.map((image) => <article key={image.id} className="rounded-lg border bg-white p-3">
              {image.imageUrl && <img className="max-h-56 w-full rounded object-contain" src={image.imageUrl} alt={t("phase7.viewImage")} />}
              <p className="mt-2 text-sm"><b>{t("phase7.imageQuality")}:</b> {image.qualityStatus}</p>
              <p className="mt-1 text-sm"><b>{t("phase7.aiResult")}:</b> {image.aiResult?.clinicallyValidated ? t("phase7.aiUnavailableLabel") : image.aiResult ? t("phase7.demoNotValidated") : t("phase7.aiUnavailableLabel")}</p>
              {image.aiResult?.model && <p className="mt-1 text-xs">{t("phase7.modelVersion")}: {image.aiResult.model.name} {image.aiResult.model.version}</p>}
              {image.aiResult?.processedAt && <p className="mt-1 text-xs">{t("phase7.processedAt")}: {new Date(image.aiResult.processedAt).toLocaleString()}</p>}
              {image.geminiObservation && <p className="mt-2 rounded bg-blue-50 p-2 text-sm"><b>{t("phase7.geminiObservation")} ({image.geminiObservation.imageQuality}):</b> {image.geminiObservation.visibleDescription}<span className="mt-1 block text-xs">{image.geminiObservation.model} · {new Date(image.geminiObservation.processedAt).toLocaleString()}</span></p>}
            </article>)}
          </div>}
          <button className="mt-3 min-h-touch rounded-xl border bg-white px-4 font-bold" type="button" onClick={() => void requestRecapture()}>{t("phase7.requestRecapture")}</button>
        </section>
        <div className="mt-5">
          <label className="block font-bold" htmlFor="doctor-decision">Decision / నిర్ణయం / निर्णय</label>
          <select id="doctor-decision" className="mt-2 min-h-touch w-full rounded-xl border px-3" value={decision} onChange={(event) => setDecision(event.target.value as ReviewChoice)}>
            <option value="agree">Agree / అంగీకరించు / सहमत</option><option value="disagree">Disagree / విభేదించు / असहमत</option><option value="defer">Defer / వాయిదా / स्थगित</option>
          </select>
          <label className="mt-4 block font-bold" htmlFor="doctor-findings">{t("phase7.reviewFindings")}</label>
          <textarea id="doctor-findings" className="mt-2 min-h-24 w-full rounded-xl border p-3" value={findings} onChange={(event) => setFindings(event.target.value)} />
          <label className="mt-4 block font-bold" htmlFor="doctor-reason">{t("phase7.reviewReason")}</label>
          <textarea id="doctor-reason" className="mt-2 min-h-24 w-full rounded-xl border p-3" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button className="primary mt-4 w-full" type="button" onClick={() => void submitReview()}>{t("phase7.saveReview")}</button>
        </div>
        <section className="mt-6 border-t pt-5">
          <h3 id="referrals" className="font-bold">{t("phase7.referralStatus")}</h3>
          {caseCareLoading && <p className="mt-2 text-sm" role="status">{t("phase7.loadingCare")}</p>}
          {caseCare?.appointments.filter((item) => item.caseId === selected._id).map((item) => <p key={item.id} className="mt-2 rounded-lg border p-3 text-sm">
            {item.hospital?.name ?? t("phase7.appointment")} · {new Date(item.startAt).toLocaleString()} · {item.status}{item.tokenNo ? ` · ${t("phase7.token")}: ${item.tokenNo}` : ""}
          </p>)}
          {!caseCareLoading && caseCare && !caseCare.appointments.some((item) => item.caseId === selected._id) && <p className="mt-2 text-sm text-slate-600">{t("phase7.noAppointments")}</p>}
          {caseCare?.referrals.filter((item) => item.caseId === selected._id).map((item) => <article key={item.id} className="mt-2 rounded-lg border p-3 text-sm">
            <p>{item.reference} · {item.destination?.name ?? item.specialty} · {t(`phase7.${item.status}`, item.status)}</p>
            {item.status === "requested" && <button className="mt-2 rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void updateReferralStatus(item.id, "accepted")}>{t("phase7.acceptReferral")}</button>}
            {item.status === "accepted" && <form className="mt-3 grid gap-2" onSubmit={(event) => {
              event.preventDefault();
              const details = referralAppointmentDetails[item.id]?.trim();
              if (!details) { setMessage(t("phase7.appointmentDetailsRequired")); return; }
              void updateReferralStatus(item.id, "scheduled", details);
            }}>
              <label>{t("phase7.appointmentDetails")}<textarea className="mt-1 min-h-20 w-full rounded-lg border p-2" value={referralAppointmentDetails[item.id] ?? ""} onChange={(event) => setReferralAppointmentDetails((current) => ({ ...current, [item.id]: event.target.value }))} required minLength={3} maxLength={1000} /></label>
              <button className="rounded-lg border px-3 py-2 font-semibold" type="submit">{t("phase7.scheduleReferral")}</button>
            </form>}
            {item.status === "scheduled" && <button className="mt-2 rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void updateReferralStatus(item.id, "completed")}>{t("phase7.completeReferral")}</button>}
          </article>)}
          {!caseCareLoading && caseCare && !caseCare.referrals.some((item) => item.caseId === selected._id) && <p className="mt-2 text-sm text-slate-600">{t("phase7.noReferrals")}</p>}
          <form className="mt-3 grid gap-3" onSubmit={(event) => void createReferral(event)}>
            <label>{t("phase7.destination")}<select className="mt-1 min-h-touch w-full rounded-xl border px-3" value={destinationId} onChange={(event) => setDestinationId(event.target.value)} required>
              <option value="">{t("phase7.chooseDestination")}</option>{destinations.map((destination) => <option value={destination._id} key={destination._id}>{destination.name}</option>)}
            </select></label>
            <label>{t("phase7.specialty")}<input className="mt-1 min-h-touch w-full rounded-xl border px-3" value={referralSpecialty} onChange={(event) => setReferralSpecialty(event.target.value)} required maxLength={120} /></label>
            <label>{t("phase7.priority")}<select className="mt-1 min-h-touch w-full rounded-xl border px-3" value={referralPriority} onChange={(event) => setReferralPriority(event.target.value as "routine" | "urgent")}><option value="routine">{t("phase7.routine")}</option><option value="urgent">{t("phase7.urgent")}</option></select></label>
            <label>{t("phase7.referralReason")}<textarea className="mt-1 min-h-20 w-full rounded-xl border p-3" value={referralReason} onChange={(event) => setReferralReason(event.target.value)} required minLength={3} maxLength={5000} /></label>
            <button className="primary" type="submit" disabled={careBusy || !destinations.length}>{careBusy ? t("loading") : t("phase7.createReferral")}</button>
          </form>
        </section>
        <section className="mt-6 border-t pt-5">
          <h3 className="font-bold">{t("phase7.followUpSchedule")}</h3>
          <form className="mt-3 grid gap-3" onSubmit={(event) => void createFollowUp(event)}>
            <label>{t("phase7.followUpDate")}<input className="mt-1 min-h-touch w-full rounded-xl border px-3" type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} required /></label>
            <label>{t("phase7.followUpNotes")}<textarea className="mt-1 min-h-20 w-full rounded-xl border p-3" value={followUpNotes} onChange={(event) => setFollowUpNotes(event.target.value)} maxLength={5000} /></label>
            <button className="primary" type="submit" disabled={careBusy}>{careBusy ? t("loading") : t("phase7.createFollowUp")}</button>
          </form>
        </section>
        <section id="diagnostics" className="mt-6 border-t pt-5">
          <h3 className="font-bold">Diagnostic test management</h3>
          <form className="mt-3 flex flex-wrap gap-3" onSubmit={(event) => void createInvestigation(event)}>
            <label className="min-w-52 flex-1 font-semibold">Test type
              <select className="mt-1 min-h-touch w-full rounded-xl border px-3" value={investigationType} onChange={(event) => setInvestigationType(event.target.value as InvestigationItem["type"])}>
                <option value="biopsy">Biopsy</option><option value="histopathology">Histopathology</option><option value="ct">CT</option><option value="mri">MRI</option>
              </select>
            </label>
            <button className="primary self-end" type="submit" disabled={investigationBusy}>{investigationBusy ? t("loading") : "Add test"}</button>
          </form>
          {investigationError && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-rose-800" role="alert">{investigationError}</p>}
          {investigationLoading ? <p className="mt-3" role="status">Loading diagnostic tests…</p>
            : investigations.length === 0 ? <p className="mt-3 text-sm text-slate-600">No diagnostic tests have been recorded for this case.</p>
              : <div className="mt-3 space-y-3">{investigations.map((item) => <article className="rounded-xl border p-4" key={item._id}>
                <div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.type.toUpperCase()}</strong><span className="rounded-full border px-2 py-1 text-sm">{item.status.replaceAll("_", " ")}</span></div>
                {item.reports.map((report) => <p className="mt-2 text-sm" key={report._id}>{report.summary} · {new Date(report.createdAt).toLocaleString()}{report.reviewedAt ? " · reviewed" : ""}</p>)}
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status === "advised" && <><button className="rounded-lg border px-3 py-2 text-sm font-semibold" type="button" disabled={investigationBusy} onClick={() => void updateInvestigationStatus(item, "scheduled")}>Schedule</button><button className="rounded-lg border px-3 py-2 text-sm font-semibold" type="button" disabled={investigationBusy} onClick={() => void updateInvestigationStatus(item, "cancelled")}>Cancel</button></>}
                  {item.status === "scheduled" && <button className="rounded-lg border px-3 py-2 text-sm font-semibold" type="button" disabled={investigationBusy} onClick={() => void updateInvestigationStatus(item, "collected")}>Mark collected</button>}
                  {item.status === "collected" && <form className="grid w-full gap-2" onSubmit={(event) => void saveInvestigationReport(event, item)}>
                    <label className="font-semibold">Report summary<textarea className="mt-1 min-h-20 w-full rounded-lg border p-3" value={reportSummaries[item._id] ?? ""} onChange={(event) => setReportSummaries((current) => ({ ...current, [item._id]: event.target.value }))} minLength={3} maxLength={10000} required /></label>
                    <button className="primary justify-self-start" type="submit" disabled={investigationBusy}>{investigationBusy ? t("loading") : "Save report"}</button>
                  </form>}
                  {item.status === "report_received" && <button className="rounded-lg border px-3 py-2 text-sm font-semibold" type="button" disabled={investigationBusy} onClick={() => void updateInvestigationStatus(item, "reviewed")}>Mark reviewed</button>}
                </div>
              </article>)}</div>}
        </section>
      </> : <div className="flex min-h-64 items-center justify-center text-center text-slate-600">Select a case / కేసును ఎంచుకోండి / केस चुनें</div>}</div>
    </section>
    <section className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <div id="patients" className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Assigned patients</h2>
        <label className="mt-3 block font-semibold">Search by patient name<input className="mt-1 min-h-touch w-full rounded-xl border px-3" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} /></label>
        {patientError && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-rose-800" role="alert">{patientError}</p>}
        <div className="mt-4 grid gap-2">{patients.map((patient) => <button key={patient._id} type="button" className={`min-h-touch rounded-xl border p-3 text-left ${selectedPatient?._id === patient._id ? "border-medical-700 bg-medical-50" : ""}`} onClick={() => void openPatientHistory(patient)}><span className="block font-bold">{patient.name}</span><span className="text-sm text-slate-600">{patient.phone ?? "Phone not recorded"}</span></button>)}
          {patients.length === 0 && !patientError && <p className="text-sm text-slate-600">No assigned patients found.</p>}
        </div>
      </div>
      <div id="medical-records" className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Patient medical history</h2>{selectedPatient && <button type="button" className="min-h-touch rounded-xl border px-3 font-semibold" onClick={() => void downloadPatientReport()}>{t("phase7.reportOpen")}</button>}</div>
        {!selectedPatient ? <p className="mt-3 text-slate-600">Select an assigned patient to review their records.</p> : recordsLoading ? <p className="mt-3">Loading records...</p> : patientRecords.length === 0 ? <p className="mt-3 text-slate-600">No uploaded records are available for this patient.</p> : <div className="mt-4 space-y-3">{patientRecords.map((record) => <article key={record.id} className="rounded-xl border p-4"><h3 className="font-bold">{record.title}</h3><p className="text-sm text-slate-600">{record.type} · {record.recordDate}{record.sourceHospital ? ` · ${record.sourceHospital}` : ""}{record.sourceHospitalType ? ` · ${record.sourceHospitalType === "private" ? "Private Hospital" : "Government Hospital"}` : ""}{record.sourceDoctor ? ` · Treating doctor: ${record.sourceDoctor}` : ""}</p>{record.notes && <p className="mt-2 text-sm">{record.notes}</p>}<div className="mt-2 flex flex-wrap gap-3">{record.media.map((mediaId) => <a className="font-semibold text-medical-700 underline" key={mediaId} href={recordUrls[mediaId]} target="_blank" rel="noreferrer">Open uploaded report</a>)}</div></article>)}</div>}
        <section id="prescriptions" className="mt-6 border-t pt-5">
          <h3 className="font-bold">E-Prescriptions</h3>
          {!selectedPatient ? <p className="mt-2 text-sm text-slate-600">Select an assigned patient to view or issue a prescription.</p> : <>
            <form className="mt-3 grid gap-3" onSubmit={(event) => void issuePrescription(event)}>
              <label className="font-semibold">Medicine name<input className="mt-1 min-h-touch w-full rounded-lg border px-3" value={prescriptionForm.medicineName} onChange={(event) => setPrescriptionForm((current) => ({ ...current, medicineName: event.target.value }))} maxLength={160} required /></label>
              <label className="font-semibold">Dosage and instructions<input className="mt-1 min-h-touch w-full rounded-lg border px-3" value={prescriptionForm.dosage} onChange={(event) => setPrescriptionForm((current) => ({ ...current, dosage: event.target.value }))} maxLength={160} required /></label>
              <label className="font-semibold">Prescription date<input className="mt-1 min-h-touch w-full rounded-lg border px-3" type="date" max={new Date().toISOString().slice(0, 10)} value={prescriptionForm.prescriptionDate} onChange={(event) => setPrescriptionForm((current) => ({ ...current, prescriptionDate: event.target.value }))} required /></label>
              <label className="font-semibold">Notes (optional)<textarea className="mt-1 min-h-20 w-full rounded-lg border p-3" value={prescriptionForm.notes} onChange={(event) => setPrescriptionForm((current) => ({ ...current, notes: event.target.value }))} maxLength={1000} /></label>
              <button className="primary" type="submit" disabled={prescriptionBusy}>{prescriptionBusy ? t("loading") : "Issue prescription"}</button>
            </form>
            {patientPrescriptions.length ? <ul className="mt-4 space-y-2">{patientPrescriptions.map((item) => <li className="rounded-lg border p-3" key={item._id}><strong>{item.medicineName}</strong> · {item.dosage}<p className="text-sm text-slate-600">{item.prescriptionDate} · {item.doctor ?? "Doctor"}{item.source === "clinician" ? " · Clinician" : ""}</p>{item.notes && <p className="mt-1 text-sm">{item.notes}</p>}</li>)}</ul> : <p className="mt-3 text-sm text-slate-600">No prescriptions are recorded for this patient.</p>}
          </>}
        </section>
      </div>
    </section>
    <section id="follow-ups" className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">{t("phase7.followUpSchedule")}</h2>
      {followUps.length === 0 ? <p className="mt-3 text-sm text-slate-600">{t("phase7.noAssignedFollowUps")}</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {followUps.map((item) => <article key={item.id} className="rounded-xl border p-4">
          <p className="font-semibold">{item.patient?.patientCode ?? item.id.slice(-8)} · {item.status}</p>
          <p className="mt-1 text-sm">{new Date(item.scheduledAt).toLocaleString()}{item.overdue ? ` · ${t("phase7.overdue")}` : ""}</p>
          {["scheduled", "rescheduled"].includes(item.status) && <div className="mt-3 flex gap-2">
            <button className="rounded-lg border px-3 py-2 text-sm font-semibold" type="button" onClick={() => void updateFollowUpStatus(item, "completed")}>{t("phase7.completed")}</button>
            <button className="rounded-lg border px-3 py-2 text-sm font-semibold" type="button" onClick={() => void updateFollowUpStatus(item, "missed")}>{t("phase7.missed")}</button>
          </div>}
        </article>)}
      </div>}
    </section>
  </main></>;
}
