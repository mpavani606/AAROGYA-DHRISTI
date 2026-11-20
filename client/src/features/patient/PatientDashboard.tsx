import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AxiosError } from "axios";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { enqueueOperation } from "../../offline/db";
import { syncNow, totalPendingCount } from "../../offline/sync";
import { useAuth } from "../auth/AuthProvider";
import api, { getApiMessage } from "../auth/api";
import {
  createOwnRefillRequest,
  downloadOwnMedicalReport,
  getOwnMedicineAvailability,
  getOwnPrescriptions,
  getOwnRefillRequests,
  getPatientProfile,
  getPatientRecords,
  getOwnHealthWorkers,
  createOwnPrescription,
  updateOwnPatientProfile,
  type PatientProfile as Profile,
  type PatientRecord,
  type HealthWorker,
  type MedicineAvailability,
  type Prescription,
  type RefillRequest
} from "./patientApi";
import {
  cancelEmergencyRequest,
  createEmergencyRequest,
  getEmergencyFacilities,
  getMyEmergencyRequests,
  getOwnHealthCamps,
  registerOwnHealthCamp,
  type EmergencyRequest
} from "../community/communityApi";
import type { PatientHealthCamp } from "../community/communityApi";

type CareSummary = {
  cases: Array<{
    id: string;
    status: string;
    createdAt: string;
    aiResult?: {
      processingStatus?: string;
      observation?: { imageQuality: string; visibleDescription: string; model: string };
    };
  }>;
  referrals: Array<{ id: string; reference?: string; destination?: { name?: string }; specialty?: string; status?: string }>;
  followUps: Array<{ id: string; scheduledAt: string; status: string }>;
};
type Appointment = {
  _id: string;
  type: "video" | "physical";
  startAt: string;
  status: string;
  tokenNo?: string;
  hospital?: { name?: string };
};
type Notification = { _id: string; template: string; status: string; createdAt: string };
type FacilityDirectory = Awaited<ReturnType<typeof getEmergencyFacilities>>;
type ConsentPurpose = "screening" | "location" | "teleconsultation" | "external_ai";
type ConsentState = Record<ConsentPurpose, boolean>;
type HealthSummary = {
  location: { village?: string | null; phc?: { name?: string; code?: string | null; address?: string | null; phone?: string | null } | null };
  riskFactors: Array<{ name: string; frequency?: string; quantity?: number; unit?: string; startedAt?: string; notes?: string }>;
  symptoms: Array<{ name: string; severity?: string; durationDays?: number }>;
  medicalHistory: Array<{ title: string; recordType: string; recordDate?: string }>;
};

const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const today = () => new Date().toISOString().slice(0, 10);
const ageFromDob = (date?: string) => {
  if (!date) return undefined;
  const birth = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return undefined;
  const now = new Date();
  return now.getUTCFullYear() - birth.getUTCFullYear() - Number(
    now.getUTCMonth() < birth.getUTCMonth()
    || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  );
};

function Module({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <section id={`patient-module-${number}`} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby={`patient-module-heading-${number}`}>
    <header className="mb-4 flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-medical-100 font-bold text-medical-800">{number}</span>
      <h2 id={`patient-module-heading-${number}`} className="text-xl font-bold text-slate-900">{title}</h2>
    </header>
    <div className="space-y-4 text-sm text-slate-700">{children}</div>
  </section>;
}

export default function PatientDashboard() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<Profile>();
  const [records, setRecords] = useState<PatientRecord[]>([]);
  const [care, setCare] = useState<CareSummary>();
  const [healthSummary, setHealthSummary] = useState<HealthSummary>();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [refills, setRefills] = useState<RefillRequest[]>([]);
  const [medicineAvailability, setMedicineAvailability] = useState<MedicineAvailability>();
  const [medicineSearch, setMedicineSearch] = useState("");
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [facilities, setFacilities] = useState<FacilityDirectory["facilities"]>([]);
  const [healthWorkers, setHealthWorkers] = useState<HealthWorker[]>([]);
  const [healthCamps, setHealthCamps] = useState<PatientHealthCamp[]>([]);
  const [consents, setConsents] = useState<ConsentState>({ screening: false, location: false, teleconsultation: false, external_ai: false });
  const [profileForm, setProfileForm] = useState({ name: "", address: "", dateOfBirth: "", gender: "" });
  const [prescriptionForm, setPrescriptionForm] = useState({ medicineName: "", dosage: "", doctor: "", prescriptionDate: today(), notes: "" });
  const [refillForm, setRefillForm] = useState({ prescriptionId: "", prescriptionRecordId: "", medicineName: "", dosage: "", quantity: "1", notes: "" });
  const [sosForm, setSosForm] = useState({ category: "urgent_help" as EmergencyRequest["category"], message: "", shareLocation: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingConsent, setSavingConsent] = useState<ConsentPurpose | null>(null);
  const [markingNotification, setMarkingNotification] = useState("");
  const [savingEmergencyId, setSavingEmergencyId] = useState("");
  const [registeringCampId, setRegisteringCampId] = useState("");
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [checkingMedicine, setCheckingMedicine] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const patient = await getPatientProfile();
      setProfile(patient);
      setProfileForm({
        name: patient.name ?? "",
        address: patient.address ?? "",
        dateOfBirth: patient.dateOfBirth?.slice(0, 10) ?? "",
        gender: patient.gender ?? ""
      });
      const results = await Promise.allSettled([
        getPatientRecords(patient.id),
        api.get<CareSummary>(`/patients/${patient.id}/care-overview`).then(({ data }) => data),
        api.get<{ appointments: Appointment[] }>("/appointments").then(({ data }) => data),
        api.get<{ notifications: Notification[] }>("/notifications").then(({ data }) => data),
        getOwnRefillRequests(),
        getMyEmergencyRequests(),
        getEmergencyFacilities(),
        ...(["screening", "location", "teleconsultation", "external_ai"] as const).map((purpose) =>
          api.get<{ granted: boolean }>(`/patients/${patient.id}/consents/${purpose}`).then(({ data }) => data)),
        api.get<HealthSummary>("/patients/me/health-summary").then(({ data }) => data),
        getOwnPrescriptions().then((items) => ({ prescriptions: items })),
        getOwnHealthWorkers().then((workers) => ({ workers })),
        getOwnHealthCamps().then((camps) => ({ camps }))
      ]);
      const failures: string[] = [];
      const value = <T,>(index: number, fallback: T) => {
        const result = results[index];
        if (result?.status === "fulfilled") return result.value as T;
        if (result?.status === "rejected") failures.push(getApiMessage(result.reason, t("phase11.loadError")));
        return fallback;
      };
      setRecords(value(0, []));
      setCare(value<CareSummary | undefined>(1, undefined));
      setAppointments(value(2, { appointments: [] }).appointments);
      setNotifications(value(3, { notifications: [] }).notifications);
      setRefills(value(4, { requests: [], availability: "unknown" as const }).requests);
      setEmergencies(value(5, { requests: [], notice: "" }).requests);
      setFacilities(value(6, { facilities: [], locationUsed: false, notice: "" }).facilities);
      setConsents({
        screening: value(7, { granted: false }).granted,
        location: value(8, { granted: false }).granted,
        teleconsultation: value(9, { granted: false }).granted,
        external_ai: value(10, { granted: false }).granted
      });
      setHealthSummary(value<HealthSummary | undefined>(11, undefined));
      setPrescriptions(value(12, { prescriptions: [] }).prescriptions);
      setHealthWorkers(value(13, { workers: [] }).workers);
      setHealthCamps(value(14, { camps: [] }).camps);
      if (failures.length) setError(failures[0]);
      setPending(await totalPendingCount());
      return failures.length === 0;
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.loadError")));
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  const synchronize = useCallback(async () => {
    setSyncing(true); setError(""); setMessage("");
    try {
      await syncNow();
      const refreshed = await refresh();
      const remaining = await totalPendingCount();
      setPending(remaining);
      if (remaining) setError(t("phase11.syncIncomplete", { count: remaining }));
      else if (refreshed) setMessage(t("phase11.saved"));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setSyncing(false);
      setPending(await totalPendingCount());
    }
  }, [refresh, t]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const refreshWhenVisible = () => { if (!document.hidden) void refresh(true); };
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);
  useEffect(() => {
    const handleOnline = () => { setOnline(navigator.onLine); if (navigator.onLine) void synchronize(); };
    const handleOffline = () => setOnline(false);
    const handleSyncComplete = () => { if (!syncing) void refresh(); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("aarogya-sync-complete", handleSyncComplete);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("aarogya-sync-complete", handleSyncComplete);
    };
  }, [refresh, synchronize, syncing]);

  const age = useMemo(() => ageFromDob(profile?.dateOfBirth) ?? profile?.ageYears, [profile?.ageYears, profile?.dateOfBirth]);
  const prescriptionOptions = [
    ...prescriptions.map((item) => ({
      key: item._id,
      prescriptionId: item._id,
      prescriptionRecordId: "",
      medicineName: item.medicineName,
      dosage: item.dosage,
      doctor: item.doctor,
      prescriptionDate: item.prescriptionDate
    })),
    ...records.filter((record) => /prescription/i.test(record.type)).map((record) => ({
      key: `record-${record.id}`,
      prescriptionId: "",
      prescriptionRecordId: record.id,
      medicineName: record.title,
      dosage: record.notes ?? "",
      doctor: record.sourceDoctor ?? "Not recorded",
      prescriptionDate: record.recordDate
    }))
  ];
  const unreadNotifications = notifications.filter((item) => item.status !== "read").length;
  const valueOrMissing = (value?: string | number | null) => value === undefined || value === null || value === "" ? t("phase11.notRecorded") : value;
  const notificationText = (template: string) => {
    const key = `phase11.notificationMessages.${template}`;
    const translated = t(key);
    return translated === key ? template.replaceAll("_", " ") : translated;
  };

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profile) {
      setError(t("phase11.loadError"));
      return;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      const fields = {
        name: profileForm.name.trim(),
        address: profileForm.address.trim(),
        dateOfBirth: profileForm.dateOfBirth || undefined,
        gender: profileForm.gender || undefined
      };
      if (!navigator.onLine) {
        await enqueueOperation("update_patient", { patientId: profile!.id, fields });
        setProfile((current) => current ? { ...current, ...fields } : current);
        setMessage(t("phase11.savedOffline"));
      } else {
        const saved = await updateOwnPatientProfile(fields);
        setProfile(saved);
        setMessage(t("phase11.saved"));
      }
      setPending(await totalPendingCount());
    } catch (requestError) {
      if (requestError instanceof AxiosError && !requestError.response && profile) {
        try {
          const fields = {
            name: profileForm.name.trim(),
            address: profileForm.address.trim(),
            dateOfBirth: profileForm.dateOfBirth || undefined,
            gender: profileForm.gender || undefined
          };
          await enqueueOperation("update_patient", { patientId: profile.id, fields });
          setProfile((current) => current ? { ...current, ...fields } : current);
          setMessage(t("phase11.savedOffline"));
          setPending(await totalPendingCount());
        } catch (queueError) {
          setError(getApiMessage(queueError, t("phase11.error")));
        }
      } else {
        setError(getApiMessage(requestError, t("phase11.error")));
      }
    } finally {
      setSaving(false);
    }
  }

  async function setConsent(purpose: ConsentPurpose, granted: boolean) {
    if (!profile) return;
    setSavingConsent(purpose);
    setError(""); setMessage("");
    try {
      await api.post(`/patients/${profile.id}/consents`, { purpose, granted, consentVersion: purpose === "external_ai" ? "gemini-screening-v1" : `${purpose}-v1` });
      setConsents((current) => ({ ...current, [purpose]: granted }));
      setMessage(t("phase11.saved"));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setSavingConsent(null);
    }
  }

  async function submitPrescription(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const prescription = await createOwnPrescription({
        medicineName: prescriptionForm.medicineName.trim(),
        dosage: prescriptionForm.dosage.trim(),
        doctor: prescriptionForm.doctor.trim() || "Not recorded",
        prescriptionDate: prescriptionForm.prescriptionDate,
        notes: prescriptionForm.notes.trim()
      });
      setPrescriptions((current) => [prescription, ...current]);
      setPrescriptionForm({ medicineName: "", dosage: "", doctor: "", prescriptionDate: today(), notes: "" });
      setMessage(t("phase11.saved"));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setSaving(false);
    }
  }

  async function submitRefill(event: FormEvent) {
    event.preventDefault();
    const clientUuid = crypto.randomUUID();
    setSaving(true); setError(""); setMessage("");
    const payload = {
      clientUuid,
      prescriptionId: refillForm.prescriptionId || undefined,
      prescriptionRecordId: refillForm.prescriptionRecordId || undefined,
      medicineName: refillForm.medicineName.trim(),
      dosage: refillForm.dosage.trim() || undefined,
      quantity: Number(refillForm.quantity),
      notes: refillForm.notes.trim() || undefined
    };
    try {
      if (!navigator.onLine) {
        await enqueueOperation("create_refill_request", payload, clientUuid);
        setMessage(t("phase11.savedOffline"));
        setRefillForm({ prescriptionId: "", prescriptionRecordId: "", medicineName: "", dosage: "", quantity: "1", notes: "" });
      } else {
        const result = await createOwnRefillRequest(payload);
        setRefills((current) => [result.request, ...current.filter((item) => item._id !== result.request._id)]);
        setMessage(t("phase11.saved"));
        setRefillForm({ prescriptionId: "", prescriptionRecordId: "", medicineName: "", dosage: "", quantity: "1", notes: "" });
      }
    } catch (requestError) {
      if (requestError instanceof AxiosError && !requestError.response) {
        try {
          await enqueueOperation("create_refill_request", payload, clientUuid);
          setMessage(t("phase11.savedOffline"));
          setRefillForm({ prescriptionId: "", prescriptionRecordId: "", medicineName: "", dosage: "", quantity: "1", notes: "" });
        } catch (queueError) {
          setError(getApiMessage(queueError, t("phase11.error")));
        }
      } else {
        setError(!navigator.onLine && requestError instanceof Error ? requestError.message : getApiMessage(requestError, t("phase11.error")));
      }
    } finally {
      setSaving(false);
      setPending(await totalPendingCount());
    }
  }

  async function checkMedicineAvailability(event: FormEvent) {
    event.preventDefault();
    setCheckingMedicine(true); setError(""); setMessage("");
    try {
      setMedicineAvailability(await getOwnMedicineAvailability(medicineSearch.trim()));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setCheckingMedicine(false);
    }
  }

  async function submitSos(event: FormEvent) {
    event.preventDefault();
    if (!sosForm.message.trim()) {
      setError(t("phase11.messageRequired"));
      return;
    }
    if (sosForm.shareLocation && !consents.location) {
      setError(t("phase11.enableLocationConsent"));
      return;
    }
    setSaving(true); setError(""); setMessage("");
    const clientRequestId = crypto.randomUUID();
    let locationWarning = "";
    let locationShareId: string | undefined;
    try {
      if (sosForm.shareLocation && profile && navigator.onLine) {
        try {
          const { data: link } = await api.post<{ demoToken: string }>(`/location/request/${profile.id}`, {});
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error(t("phase11.locationError")));
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
          });
          const { data: shared } = await api.post<{ share: { _id: string } }>("/location/share", {
            token: link.demoToken,
            patientId: profile.id,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
          });
          locationShareId = shared.share._id;
        } catch (locationError) {
          locationWarning = getApiMessage(locationError, t("phase11.locationError"));
        }
      } else if (sosForm.shareLocation) {
        locationWarning = t("phase11.locationOffline");
      }
      const payload = {
        clientRequestId,
        category: sosForm.category,
        message: sosForm.message.trim(),
        locationShareId
      };
      if (!navigator.onLine) {
        await enqueueOperation("create_emergency_request", payload, clientRequestId);
        setMessage(`${t("phase11.offlineSos")}${locationWarning ? ` ${locationWarning}` : ""}`);
        setSosForm({ category: "urgent_help", message: "", shareLocation: false });
      } else {
        await createEmergencyRequest(payload);
        setMessage(`${locationWarning ? `${locationWarning} ` : ""}${t("phase11.sosDisclaimer")}`);
        setSosForm({ category: "urgent_help", message: "", shareLocation: false });
        setEmergencies((await getMyEmergencyRequests()).requests);
      }
    } catch (requestError) {
      if (requestError instanceof AxiosError && !requestError.response) {
        try {
          await enqueueOperation("create_emergency_request", {
            clientRequestId,
            category: sosForm.category,
            message: sosForm.message.trim(),
            locationShareId
          }, clientRequestId);
          setMessage(`${t("phase11.offlineSos")}${locationWarning ? ` ${locationWarning}` : ""}`);
          setSosForm({ category: "urgent_help", message: "", shareLocation: false });
        } catch (queueError) {
          setError(getApiMessage(queueError, t("phase11.error")));
        }
      } else {
        setError(!navigator.onLine && requestError instanceof Error ? requestError.message : getApiMessage(requestError, t("phase11.error")));
      }
    } finally {
      setSaving(false);
      setPending(await totalPendingCount());
    }
  }

  async function markNotificationRead(notification: Notification) {
    setError("");
    setMarkingNotification(notification._id);
    try {
      await api.patch<{ notification: Notification }>(`/notifications/${notification._id}/read`);
      setNotifications((current) => current.map((item) => item._id === notification._id ? { ...item, status: "read" } : item));
      setMessage(t("phase11.saved"));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setMarkingNotification("");
    }
  }

  async function downloadReport() {
    if (!profile) return;
    setDownloadingReport(true);
    setError("");
    try {
      await downloadOwnMedicalReport(profile.id);
      setMessage(t("phase11.downloadStarted"));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setDownloadingReport(false);
    }
  }

  async function cancelSos(id: string) {
    setError("");
    setSavingEmergencyId(id);
    try {
      await cancelEmergencyRequest(id);
      setEmergencies((await getMyEmergencyRequests()).requests);
      setMessage(t("phase11.saved"));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setSavingEmergencyId("");
    }
  }

  async function registerForCamp(campId: string) {
    setRegisteringCampId(campId);
    setError("");
    setMessage("");
    try {
      const { data } = await registerOwnHealthCamp(campId);
      setHealthCamps((current) => current.map((camp) => camp._id === campId
        ? { ...camp, participantStatus: data.participant.status }
        : camp));
      setMessage(t("phase11.campRegistered"));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase11.error")));
    } finally {
      setRegisteringCampId("");
    }
  }

  async function signOut() {
    try { await logout(); }
    catch (requestError) { setError(getApiMessage(requestError, t("phase11.error"))); }
    finally { window.location.assign("/patient/login"); }
  }

  function openAssistant() {
    window.dispatchEvent(new Event("aarogya-open-assistant"));
  }

  const moduleTitle = (n: number) => t(`phase11.${["", "screening", "booking", "consultation", "reports", "medicines", "emergency", "healthWorker", "healthCamps", "notifications", "profile", "settings"][n]}`);

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <SimulationBanner />
    <main className="mx-auto max-w-6xl space-y-5 px-4 pb-12 pt-20">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">{t("phase11.title")}</h1>
          <p className="mt-1 text-slate-600">{t("phase11.subtitle")}{profile?.name ? ` · ${profile.name}` : user?.name ? ` · ${user.name}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitcher />
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${online ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>{online ? t("phase11.online") : t("phase11.offline")}</span>
        </div>
      </header>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-900" role="status">{message}</p>}
      {loading && <p className="rounded-xl bg-white p-4" role="status">{t("phase11.loading")}</p>}

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label={t("phase11.title")} className="h-fit overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-4 lg:overflow-visible">
          <ol className="flex min-w-max gap-2 lg:min-w-0 lg:flex-col">
            {Array.from({ length: 11 }, (_, index) => index + 1).map((number) => (
              <li key={number}>
                <a className="block rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-medical-50 hover:text-medical-900 focus:outline-none focus:ring-2 focus:ring-medical-600" href={`#patient-module-${number}`}>
                  <span className="mr-2 text-medical-700">{number}.</span>{moduleTitle(number)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Module number={1} title={moduleTitle(1)}>
          <p>{t("phase11.clinicianReview")}</p>
          <p className="rounded-lg bg-blue-50 p-3 text-blue-900">{t("phase11.externalAiDisclosure")}</p>
          <Link className="inline-flex min-h-10 items-center rounded-lg bg-medical-700 px-4 font-semibold text-white" to="/patient/screening">{t("phase11.startScreening")}</Link>
          <div><h3 className="font-bold">{t("phase11.screeningHistory")}</h3>
            {!care?.cases.length && <p>{t("phase11.noScreenings")}</p>}
            <ul className="space-y-2">{care?.cases.slice(0, 5).map((item) => <li key={item.id} className="rounded-lg bg-slate-50 p-3">
              <p>{new Date(item.createdAt).toLocaleDateString()} · {item.status} · {item.aiResult?.processingStatus === "demo_not_validated" ? t("phase11.demoAI") : item.aiResult?.processingStatus === "gemini_observation" ? t("phase11.geminiObservation") : item.aiResult?.processingStatus ?? "—"}</p>
              {item.aiResult?.observation && <p className="mt-1">{item.aiResult.observation.visibleDescription} <span className="text-xs">({item.aiResult.observation.imageQuality} · {item.aiResult.observation.model})</span></p>}
            </li>)}</ul>
          </div>
          <div><h3 className="font-bold">{t("phase11.referrals")}</h3>
            {care?.referrals.length ? <ul>{care.referrals.map((item) => <li key={item.id}>{item.destination?.name ?? item.specialty ?? item.reference} · {item.status}</li>)}</ul> : <p>{t("phase11.noScreenings")}</p>}
          </div>
        </Module>

        <Module number={2} title={moduleTitle(2)}>
          <Link className="inline-flex min-h-10 items-center rounded-lg bg-medical-700 px-4 font-semibold text-white" to="/appointments#hospital-directory">{t("phase11.bookNow")}</Link>
          <h3 className="font-bold">{t("phase11.appointments")}</h3>
          {appointments.length ? <ul className="space-y-2">{appointments.slice(0, 5).map((item) => <li key={item._id} className="rounded-lg bg-slate-50 p-3">{new Date(item.startAt).toLocaleString()} · {item.hospital?.name ?? t("phase11.notRecorded")} · {item.status}</li>)}</ul> : <p>{t("phase11.noAppointments")}</p>}
        </Module>

        <Module number={3} title={moduleTitle(3)}>
          <p>{t("phase11.onlineConsultationInfo")}</p>
          <Link className="inline-flex min-h-10 items-center rounded-lg border px-4 font-semibold text-medical-800" to="/appointments">{t("phase11.openConsultations")}</Link>
          <div>
            <h3 className="font-bold">{t("phase11.consultationHistory")}</h3>
            {appointments.filter((item) => item.type === "video").length ? <ul className="mt-2 space-y-2">
              {appointments.filter((item) => item.type === "video").map((item) => <li key={item._id} className="rounded-lg bg-slate-50 p-3">
                <p>{new Date(item.startAt).toLocaleString()} · {item.hospital?.name ?? t("phase11.notRecorded")} · {item.status}</p>
                <p className="mt-1 text-xs text-slate-600">{item.status === "confirmed" ? t("phase11.onlineConsultationInfo") : t("phase11.consultationPending")}</p>
              </li>)}
            </ul> : <p className="mt-2">{t("phase11.noConsultations")}</p>}
          </div>
        </Module>

        <Module number={4} title={moduleTitle(4)}>
          <p>{t("phase11.records")}: {records.length + prescriptions.length}</p>
          {records.length ? <ul className="space-y-1">{records.slice(0, 5).map((record) => <li key={record.id}>{record.title} · {record.type} · {record.recordDate || "—"}</li>)}</ul> : prescriptions.length === 0 && <p>{t("phase11.noRecords")}</p>}
          {prescriptions.length > 0 && <ul className="space-y-1">{prescriptions.slice(0, 5).map((item) => <li key={item._id}>{item.medicineName} · {item.dosage} · {item.doctor} · {item.prescriptionDate}</li>)}</ul>}
          <p>{t("phase11.prescriptionRecords")}: {prescriptions.length + records.filter((record) => /prescription/i.test(record.type)).length} · {t("phase11.labReports")}: {records.filter((record) => /lab/i.test(record.type)).length}</p>
          <div className="flex flex-wrap gap-3">
            <button className="min-h-10 rounded-lg border px-4 font-semibold text-medical-800 disabled:opacity-50" type="button" disabled={downloadingReport} onClick={() => void downloadReport()}>{downloadingReport ? t("phase11.submitting") : t("phase11.downloadScreeningReport")}</button>
            <Link className="inline-flex min-h-10 items-center rounded-lg border px-4 font-semibold text-medical-800" to="/patient/profile">{t("phase11.openReports")}</Link>
          </div>
        </Module>

        <Module number={5} title={moduleTitle(5)}>
          <p>{t("phase11.medicineAvailability")}</p>
          <p>{t("phase11.availabilityInfo")}</p>
          <form className="flex flex-wrap gap-3" onSubmit={(event) => void checkMedicineAvailability(event)}>
            <label className="min-w-56 flex-1">{t("phase11.stockSearch")}<input className={fieldClass} required maxLength={160} value={medicineSearch} onChange={(event) => setMedicineSearch(event.target.value)} /></label>
            <button className="min-h-11 self-end rounded-lg bg-medical-700 px-4 font-semibold text-white disabled:opacity-50" type="submit" disabled={checkingMedicine}>{checkingMedicine ? t("phase11.checkingStock") : t("phase11.checkStock")}</button>
          </form>
          {medicineAvailability && <div className="space-y-2 rounded-lg bg-slate-50 p-3" aria-live="polite">
            <h3 className="font-bold">{medicineAvailability.medicineName}</h3>
            {!medicineAvailability.facilities.length ? <p>{t(medicineAvailability.availability === "not_recorded" ? "phase11.stockNotRecorded" : "phase11.noMedicineFound")}</p> : medicineAvailability.facilities.map((facility) => <article className="rounded border bg-white p-3" key={`${facility.hospital}-${facility.medicineName}-${facility.updatedAt}`}>
              <p className="font-semibold">{facility.medicineName} · {facility.hospital} · {facility.quantity} {facility.unit} · {facility.availability === "available" ? t("phase11.stockAvailable") : t("phase11.stockOut")}</p>
              {facility.synthetic && <p className="text-amber-800">{t("phase11.demoInventory")}</p>}
              {facility.address && <p>{facility.address}</p>}
              {facility.phone && <a className="underline" href={`tel:${facility.phone}`}>{facility.phone}</a>}
              <p className="text-xs text-slate-600">{t("phase11.stockUpdated")}: {new Date(facility.updatedAt).toLocaleString()}</p>
            </article>)}
          </div>}
          <h3 className="font-bold">{t("phase11.prescriptionRecords")}</h3>
          {prescriptionOptions.length ? <ul>{prescriptionOptions.slice(0, 5).map((item) => <li key={item.key}>{item.medicineName} · {item.dosage} · {item.doctor} · {item.prescriptionDate}</li>)}</ul> : <p>{t("phase11.noRecords")}</p>}
          <form className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2" onSubmit={(event) => void submitPrescription(event)}>
            <h3 className="font-bold sm:col-span-2">{t("phase11.addPrescription")}</h3>
            <label>{t("phase11.medicineName")}<input className={fieldClass} required maxLength={160} value={prescriptionForm.medicineName} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, medicineName: event.target.value })} /></label>
            <label>{t("phase11.dosage")}<input className={fieldClass} required maxLength={160} value={prescriptionForm.dosage} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, dosage: event.target.value })} /></label>
            <label>{t("phase11.prescriptionDoctor")}<input className={fieldClass} maxLength={160} value={prescriptionForm.doctor} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, doctor: event.target.value })} /></label>
            <label>{t("phase11.prescriptionDate")}<input className={fieldClass} type="date" max={today()} required value={prescriptionForm.prescriptionDate} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, prescriptionDate: event.target.value })} /></label>
            <label className="sm:col-span-2">{t("phase11.notes")}<textarea className={fieldClass} maxLength={1000} value={prescriptionForm.notes} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, notes: event.target.value })} /></label>
            <p className="sm:col-span-2 text-xs text-slate-600">{t("phase11.patientReportedPrescription")}</p>
            <button className="min-h-10 rounded-lg border px-4 font-semibold sm:col-span-2" type="submit" disabled={saving}>{saving ? t("phase11.submitting") : t("phase11.savePrescription")}</button>
          </form>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submitRefill(event)}>
            <h3 className="font-bold sm:col-span-2">{t("phase11.refillRequest")}</h3>
            <label>{t("phase11.medicineName")}<input className={fieldClass} required maxLength={160} value={refillForm.medicineName} onChange={(event) => setRefillForm({ ...refillForm, prescriptionId: "", prescriptionRecordId: "", medicineName: event.target.value })} /></label>
            <label>{t("phase11.dosage")}<input className={fieldClass} maxLength={160} value={refillForm.dosage} onChange={(event) => setRefillForm({ ...refillForm, dosage: event.target.value })} /></label>
            <label>{t("phase11.quantity")}<input className={fieldClass} type="number" min={1} max={365} required value={refillForm.quantity} onChange={(event) => setRefillForm({ ...refillForm, quantity: event.target.value })} /></label>
            <label>{t("phase11.prescriptionRecords")}<select className={fieldClass} value={prescriptionOptions.find((item) => item.prescriptionId === refillForm.prescriptionId && item.prescriptionRecordId === refillForm.prescriptionRecordId)?.key ?? ""} onChange={(event) => {
              const selected = prescriptionOptions.find((item) => item.key === event.target.value);
              setRefillForm((current) => ({
                ...current,
                prescriptionId: selected?.prescriptionId ?? "",
                prescriptionRecordId: selected?.prescriptionRecordId ?? "",
                medicineName: selected?.medicineName ?? current.medicineName,
                dosage: selected?.dosage ?? current.dosage
              }));
            }}><option value="">—</option>{prescriptionOptions.map((item) => <option key={item.key} value={item.key}>{item.medicineName} · {item.dosage}</option>)}</select></label>
            <label className="sm:col-span-2">{t("phase11.notes")}<textarea className={fieldClass} maxLength={500} value={refillForm.notes} onChange={(event) => setRefillForm({ ...refillForm, notes: event.target.value })} /></label>
            <button className="min-h-10 rounded-lg bg-medical-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2" type="submit" disabled={saving}>{saving ? t("phase11.submitting") : t("phase11.submit")}</button>
          </form>
          <h3 className="font-bold">{t("phase11.refillHistory")}</h3>
          {refills.length ? <ul>{refills.map((item) => <li key={item._id}>{item.medicineName} · {item.quantity} · {t(`phase11.${item.status === "requested" ? "pendingStatus" : item.status}`)} · {new Date(item.createdAt).toLocaleDateString()}</li>)}</ul> : <p>{t("phase11.noRefills")}</p>}
        </Module>

        <Module number={6} title={moduleTitle(6)}>
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900">This app does not dispatch emergency services or guarantee a response.</p>
          <p>{t("phase11.sosWarning")}</p>
          <form className="grid gap-3" onSubmit={(event) => void submitSos(event)}>
            <label>{t("phase11.category")}<select className={fieldClass} value={sosForm.category} onChange={(event) => setSosForm({ ...sosForm, category: event.target.value as EmergencyRequest["category"] })}><option value="urgent_help">{t("phase11.urgentHelp")}</option><option value="transport">{t("phase11.transport")}</option><option value="other">{t("phase11.other")}</option></select></label>
            <label>{t("phase11.message")}<textarea className={fieldClass} required minLength={1} maxLength={500} value={sosForm.message} onChange={(event) => setSosForm({ ...sosForm, message: event.target.value })} /></label>
            <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={sosForm.shareLocation} onChange={(event) => setSosForm({ ...sosForm, shareLocation: event.target.checked })} /><span>{t("phase11.shareLocation")}</span></label>
            {sosForm.shareLocation && !consents.location && <p className="text-amber-800" role="status">{t("phase11.enableLocationConsent")} <a className="underline" href="#patient-module-11">{t("phase11.privacy")}</a></p>}
            {!online && sosForm.shareLocation && <p className="text-amber-800">{t("phase11.locationOffline")}</p>}
            <button className="min-h-10 rounded-lg bg-red-700 px-4 font-semibold text-white disabled:opacity-50" type="submit" disabled={saving}>{saving ? t("phase11.submitting") : t("phase11.sendSos")}</button>
          </form>
          <h3 className="font-bold">{t("phase11.sosHistory")}</h3>
          {emergencies.length ? <ul className="space-y-2">{emergencies.map((item) => <li key={item.id} className="rounded-lg bg-slate-50 p-3">{item.category} · {item.status} · {new Date(item.createdAt).toLocaleString()}{["submitted", "open"].includes(item.status) && <button className="ml-3 underline disabled:opacity-50" type="button" disabled={savingEmergencyId === item.id} onClick={() => void cancelSos(item.id)}>{savingEmergencyId === item.id ? t("phase11.submitting") : t("phase11.cancel")}</button>}</li>)}</ul> : <p>{t("phase11.noSos")}</p>}
          <h3 className="font-bold">{t("phase11.nearestPhc")}</h3>
          {!facilities.length && <p>{t("phase11.noFacilities")}</p>}
          {facilities.slice(0, 5).map((facility) => {
            const destination = typeof facility.lat === "number" && typeof facility.lng === "number"
              ? `${facility.lat},${facility.lng}`
              : [facility.name, facility.address].filter(Boolean).join(" ");
            const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
            return <article key={facility.id} className="rounded-lg bg-slate-50 p-3">
              <p className="font-semibold">{facility.name} · {facility.type}</p>
              {facility.address && <p>{facility.address}</p>}
              <p>{facility.distanceKm === null ? t("phase11.unknown") : `${facility.distanceKm} km`} · {t(`phase11.availability${facility.availability[0]?.toLocaleUpperCase()}${facility.availability.slice(1)}`)}</p>
              <div className="flex gap-3">
                {facility.phone && <a className="underline" href={`tel:${facility.phone}`}>{t("phase11.callFacility")}</a>}
                <a className="underline" href={directionsUrl} target="_blank" rel="noreferrer">{t("phase11.directions")}</a>
              </div>
            </article>;
          })}
        </Module>

        <Module number={7} title={moduleTitle(7)}>
          <p>{t("phase11.healthWorkerInfo")}</p>
          {healthWorkers.length ? <ul className="space-y-2">{healthWorkers.map((worker) => <li key={worker.id} className="rounded-lg bg-slate-50 p-3">
            <p className="font-semibold">{worker.name}</p>
            <div className="flex flex-wrap gap-3">
              {worker.phone && <a className="underline" href={`tel:${worker.phone}`}>{worker.phone}</a>}
              {worker.email && <a className="underline" href={`mailto:${worker.email}`}>{worker.email}</a>}
              {!worker.phone && !worker.email && <span>{t("phase11.noContactDetails")}</span>}
            </div>
          </li>)}</ul> : <p>{t("phase11.noAssignedWorker")}</p>}
        </Module>

        <Module number={8} title={moduleTitle(8)}>
          {healthCamps.length ? <ul className="space-y-2">{healthCamps.map((camp) => <li key={camp._id} className="rounded-lg bg-slate-50 p-3">
            <p className="font-semibold">{camp.title}</p>
            <p>{new Date(camp.startsAt).toLocaleString()} – {new Date(camp.endsAt).toLocaleString()}</p>
            <p>{[camp.village?.name_en ?? camp.village?.name_te ?? camp.village?.name, camp.phc?.name_en ?? camp.phc?.name, camp.hospital?.name].filter(Boolean).join(" · ") || t("phase11.notRecorded")}</p>
            <p>{t("phase11.campStatus")}: {t(camp.status === "open" ? "phase11.campOpen" : "phase11.campPlanned")}</p>
            {camp.assignedDoctors.length > 0 && <p>{t("phase11.campDoctors")}: {camp.assignedDoctors.map((doctor) => doctor.name).join(", ")}</p>}
            {camp.participantStatus
              ? <p className="font-semibold text-green-800">{t(camp.participantStatus === "registered" ? "phase11.campRegistered" : camp.participantStatus === "attended" ? "phase11.campAttended" : "phase11.campNoShow")}</p>
              : <button className="min-h-10 rounded-lg border px-4 font-semibold disabled:opacity-50" type="button" disabled={registeringCampId === camp._id} onClick={() => void registerForCamp(camp._id)}>{registeringCampId === camp._id ? t("phase11.submitting") : t("phase11.registerForCamp")}</button>}
          </li>)}</ul> : <p>{t("phase11.noHealthCamps")}</p>}
        </Module>

        <Module number={9} title={moduleTitle(9)}>
          <h3 className="flex items-center gap-2 font-bold">{t("phase11.notifications")}<span className="rounded-full bg-medical-100 px-2 py-0.5 text-xs text-medical-900" aria-label={t("phase11.unreadCount", { count: unreadNotifications })}>{unreadNotifications}</span></h3>
          {notifications.length ? <ul className="space-y-2">{notifications.map((item) => <li key={item._id} className={`rounded-lg p-3 ${item.status === "read" ? "bg-slate-50" : "bg-blue-50 font-semibold"}`}><p>{notificationText(item.template)}</p><small>{new Date(item.createdAt).toLocaleString()} · {t(item.status === "read" ? "phase11.readStatus" : "phase11.unreadStatus")}</small>{item.status !== "read" && <button className="ml-3 underline disabled:opacity-50" type="button" disabled={markingNotification === item._id} onClick={() => void markNotificationRead(item)}>{markingNotification === item._id ? t("phase11.submitting") : t("phase11.markRead")}</button>}</li>)}</ul> : <p>{t("phase11.noNotifications")}</p>}
        </Module>

        <Module number={10} title={moduleTitle(10)}>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt className="font-semibold">{t("phase11.patientId")}</dt><dd>{valueOrMissing(profile?.patientCode ?? profile?.id)}</dd></div>
            <div><dt className="font-semibold">{t("phase11.name")}</dt><dd>{valueOrMissing(profile?.name)}</dd></div>
            <div><dt className="font-semibold">{t("phase11.age")}</dt><dd>{age === undefined ? t("phase11.notRecorded") : `${age} ${t("phase11.years")}`}</dd></div>
            <div><dt className="font-semibold">{t("phase11.gender")}</dt><dd>{valueOrMissing(profile?.gender)}</dd></div>
            <div><dt className="font-semibold">{t("phase11.village")}</dt><dd>{valueOrMissing(healthSummary?.location?.village ?? profile?.village)}</dd></div>
            <div><dt className="font-semibold">{t("phase11.phc")}</dt><dd>{valueOrMissing(healthSummary?.location.phc?.name)}{healthSummary?.location.phc?.code ? ` · ${healthSummary.location.phc.code}` : ""}</dd></div>
          </dl>
          {healthSummary?.location.phc?.address && <p><b>{t("phase11.phcAddress")}:</b> {healthSummary.location.phc.address}</p>}
          {healthSummary?.location.phc?.phone && <p><b>{t("phase11.phcPhone")}:</b> <a className="underline" href={`tel:${healthSummary.location.phc.phone}`}>{healthSummary.location.phc.phone}</a></p>}
          <div><b>{t("phase11.medicalHistory")}:</b> {(healthSummary?.medicalHistory.length ?? 0) + records.length + prescriptions.length} {t("phase11.records").toLocaleLowerCase()}
            {Boolean(healthSummary?.medicalHistory.length) && <ul className="mt-1 list-inside list-disc">{healthSummary?.medicalHistory.slice(0, 3).map((record, index) => <li key={`${record.recordDate ?? "record"}-${index}`}>{record.title} · {record.recordDate ?? record.recordType}</li>)}</ul>}
          </div>
          <div><b>{t("phase11.riskFactors")}:</b> {healthSummary?.riskFactors.length || healthSummary?.symptoms.length
            ? [...(healthSummary?.riskFactors ?? []).map((item) => `${item.name}${item.frequency ? ` · ${item.frequency}` : ""}`), ...(healthSummary?.symptoms ?? []).map((item) => `${item.name}${item.severity ? ` · ${item.severity}` : ""}`)].join(", ")
            : t("phase11.notRecorded")}</div>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void saveProfile(event)}>
            <h3 className="font-bold sm:col-span-2">{t("phase11.profileSettings")}</h3>
            <label>{t("phase11.name")}<input className={fieldClass} minLength={2} maxLength={200} required value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} /></label>
            <label>{t("phase11.dateOfBirth")}<input className={fieldClass} type="date" max={today()} value={profileForm.dateOfBirth} onChange={(event) => setProfileForm({ ...profileForm, dateOfBirth: event.target.value })} /></label>
            <label>{t("phase11.gender")}<select className={fieldClass} value={profileForm.gender} onChange={(event) => setProfileForm({ ...profileForm, gender: event.target.value })}><option value="">—</option><option value="female">{t("phase11.genderFemale")}</option><option value="male">{t("phase11.genderMale")}</option><option value="other">{t("phase11.genderOther")}</option><option value="prefer_not_to_say">{t("phase11.genderPreferNot")}</option></select></label>
            <label>{t("phase11.address")}<input className={fieldClass} maxLength={500} value={profileForm.address} onChange={(event) => setProfileForm({ ...profileForm, address: event.target.value })} /></label>
            <button className="min-h-10 rounded-lg bg-medical-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2" type="submit" disabled={saving}>{saving ? t("phase11.submitting") : t("phase11.saveProfile")}</button>
          </form>
        </Module>

        <Module number={11} title={moduleTitle(11)}>
          <p>{t("phase11.help")}</p>
          <p>{t("phase11.assistantInfo")}</p>
          <p className="text-amber-800">{t("phase11.voiceLimit")}</p>
          <button className="min-h-10 rounded-lg bg-medical-700 px-4 font-semibold text-white" type="button" onClick={openAssistant}>{t("phase11.openAssistant")}</button>
          <div className="space-y-2">
            <h3 className="font-bold">{t("phase11.privacy")}</h3>
            {([
              ["screening", "screeningConsent"],
              ["location", "locationConsent"],
              ["teleconsultation", "telemedicineConsent"],
              ["external_ai", "externalAiConsent"]
            ] as const).map(([purpose, label]) => <label key={purpose} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
              <span>{t(`phase11.${label}`)}{purpose === "external_ai" && <span className="block text-xs text-slate-600">{t("phase11.externalAiDisclosure")}</span>} · {consents[purpose] ? t("phase11.consentGranted") : t("phase11.consentDeclined")}</span>
              <input type="checkbox" checked={consents[purpose]} disabled={savingConsent === purpose} onChange={(event) => void setConsent(purpose, event.target.checked)} aria-label={t(`phase11.${label}`)} />
            </label>)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span>{t("phase11.sync")}: {pending} {t("phase11.pending")}</span>
            <button className="min-h-10 rounded-lg border px-4 font-semibold" type="button" disabled={syncing || !online} onClick={() => void synchronize()}>{syncing ? t("phase11.syncing") : t("phase11.syncNow")}</button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a className="underline" href="tel:104">{t("phase11.call104")}</a>
            <button className="min-h-10 rounded-lg border px-4 font-semibold" type="button" onClick={() => void signOut()}>{t("phase11.logout")}</button>
          </div>
        </Module>
        </div>
      </div>
    </main>
  </div>;
}
