import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";
import { getApiMessage } from "../auth/api";
import {
  cancelEmergencyRequest,
  createCamp,
  createEmergencyRequest,
  downloadCampReport,
  getCamps,
  getCommunityOptions,
  getEmergencyFacilities,
  getEmergencyContactDetails,
  getEmergencyQueue,
  getMyEmergencyRequests,
  recordCampAttendance,
  recordEmergencyContactAttempt,
  registerCampParticipant,
  updateCampStatus,
  updateEmergencyRequest,
  escalateEmergencyRequest,
  type Camp,
  type CommunityOptions,
  type EmergencyRequest
} from "./communityApi";

const fieldClass = "mt-1 min-h-touch w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const localizedName = (item: { name_en?: string; name?: string }) => item.name_en ?? item.name ?? "";

type ParticipantFields = { patientId: string; caseId: string; participantId: string };
const emptyParticipant: ParticipantFields = { patientId: "", caseId: "", participantId: "" };

export default function CommunityPortal() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isPatient = user?.role === "patient";
  const [options, setOptions] = useState<CommunityOptions>();
  const [camps, setCamps] = useState<Camp[]>([]);
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [facilities, setFacilities] = useState<Awaited<ReturnType<typeof getEmergencyFacilities>>>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [participantFields, setParticipantFields] = useState<Record<string, ParticipantFields>>({});
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
  const [campForm, setCampForm] = useState({
    title: "",
    startsAt: "",
    endsAt: "",
    mandalId: "",
    phcId: "",
    villageId: "",
    hospitalId: ""
  });
  const [emergencyForm, setEmergencyForm] = useState({
    category: "urgent_help" as EmergencyRequest["category"], message: "", contactName: "", contactPhone: "", contactRelationship: "", contactConsent: false
  });
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [emergencyContacts, setEmergencyContacts] = useState<Record<string, { name: string; phone: string; relationship: string }>>({});
  const [attemptOutcomes, setAttemptOutcomes] = useState<Record<string, "reached" | "no_answer" | "unavailable" | "not_attempted">>({});
  const [escalationReasons, setEscalationReasons] = useState<Record<string, string>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (isPatient) {
        const [own, directory] = await Promise.all([getMyEmergencyRequests(), getEmergencyFacilities()]);
        setRequests(own.requests);
        setFacilities(directory);
      } else {
        const [nextOptions, nextCamps, queue] = await Promise.all([
          user?.role === "asha_worker" ? Promise.resolve(undefined) : getCommunityOptions(),
          getCamps(),
          getEmergencyQueue()
        ]);
        if (nextOptions) setOptions(nextOptions);
        setCamps(nextCamps);
        setRequests(queue.requests);
        if (user?.role === "hospital_manager" && nextOptions?.hospitals[0]) {
          setCampForm((current) => ({ ...current, hospitalId: nextOptions.hospitals[0]._id }));
        }
      }
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.loadError")));
    } finally {
      setLoading(false);
    }
  }, [isPatient, t, user?.role]);

  useEffect(() => { void refresh(); }, [refresh]);

  function updateParticipant(campId: string, field: keyof ParticipantFields, value: string) {
    setParticipantFields((current) => ({ ...current, [campId]: { ...emptyParticipant, ...current[campId], [field]: value } }));
  }

  async function submitCamp(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createCamp({
        ...campForm,
        startsAt: new Date(campForm.startsAt).toISOString(),
        endsAt: new Date(campForm.endsAt).toISOString(),
        hospitalId: campForm.hospitalId || undefined,
        assignedDoctorIds: selectedDoctors
      });
      setCampForm((current) => ({ ...current, title: "", startsAt: "", endsAt: "", phcId: "", villageId: "" }));
      setSelectedDoctors([]);
      setMessage(t("phase10.saved"));
      await refresh();
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.createError")));
    } finally {
      setSaving(false);
    }
  }

  async function changeCampStatus(camp: Camp, status: "open" | "completed") {
    setError("");
    setMessage("");
    try {
      await updateCampStatus(camp._id, status);
      setMessage(t("phase10.saved"));
      await refresh();
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.manageError")));
    }
  }

  async function enrollParticipant(campId: string) {
    const fields = participantFields[campId] ?? emptyParticipant;
    setError("");
    setMessage("");
    try {
      const { data } = await registerCampParticipant(campId, fields.patientId.trim(), fields.caseId.trim() || undefined);
      setParticipantFields((current) => ({ ...current, [campId]: { ...fields, participantId: data.participant.id } }));
      setMessage(t("phase10.participantRegistered"));
      await refresh();
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.participantError")));
    }
  }

  async function markAttendance(campId: string, participantId: string, status: "attended" | "no_show") {
    setError("");
    setMessage("");
    try {
      await recordCampAttendance(campId, participantId.trim(), status);
      setMessage(t("phase10.saved"));
      await refresh();
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.participantError")));
    }
  }

  async function sendSos(event: React.FormEvent) {
    event.preventDefault();
    if (!emergencyForm.message.trim()) {
      setError(t("phase10.sosMessageRequired"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createEmergencyRequest({
        clientRequestId: crypto.randomUUID(),
        category: emergencyForm.category,
        message: emergencyForm.message.trim(),
        ...(emergencyForm.contactName.trim() || emergencyForm.contactPhone.trim() || emergencyForm.contactRelationship.trim()
          ? {
            emergencyContactName: emergencyForm.contactName.trim(),
            emergencyContactPhone: emergencyForm.contactPhone.trim(),
            emergencyContactRelationship: emergencyForm.contactRelationship.trim(),
            ...(emergencyForm.contactConsent ? { emergencyContactConsent: true as const } : {})
          }
          : {})
      });
      setEmergencyForm({ category: "urgent_help", message: "", contactName: "", contactPhone: "", contactRelationship: "", contactConsent: false });
      setMessage(t("phase10.sosSent"));
      await refresh();
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.sosError")));
    } finally {
      setSaving(false);
    }
  }

  async function cancelSos(requestId: string) {
    setError("");
    try {
      await cancelEmergencyRequest(requestId);
      await refresh();
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.manageError")));
    }
  }

  async function updateRequest(request: EmergencyRequest, status: "assigned" | "acknowledged" | "resolved") {
    setError("");
    try {
      const body = status === "assigned"
        ? { status, assignedTo: user?.role === "doctor" ? user.id : assignees[request.id] }
        : status === "resolved" ? { status, resolutionNote: resolutionNotes[request.id]?.trim() || undefined } : { status };
      await updateEmergencyRequest(request.id, body);
      setMessage(t("phase10.saved"));
      await refresh();
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase10.manageError")));
    }
  }

  async function revealEmergencyContact(requestId: string) {
    setError("");
    try {
      const { contact } = await getEmergencyContactDetails(requestId);
      setEmergencyContacts((current) => ({ ...current, [requestId]: contact }));
    } catch (requestError) { setError(getApiMessage(requestError, t("phase10.contactDetailsError"))); }
  }

  async function recordContactAttempt(requestId: string) {
    setError("");
    try {
      await recordEmergencyContactAttempt(requestId, { channel: "phone", outcome: attemptOutcomes[requestId] ?? "not_attempted" });
      setMessage(t("phase10.saved"));
      await refresh();
    } catch (requestError) { setError(getApiMessage(requestError, t("phase10.manageError"))); }
  }

  async function escalateRequest(requestId: string) {
    const reason = escalationReasons[requestId]?.trim();
    if (!reason) { setError(t("phase10.escalationReason")); return; }
    setError("");
    try {
      await escalateEmergencyRequest(requestId, { reason });
      setEscalationReasons((current) => ({ ...current, [requestId]: "" }));
      setMessage(t("phase10.saved"));
      await refresh();
    } catch (requestError) { setError(getApiMessage(requestError, t("phase10.manageError"))); }
  }

  const availablePhcs = options?.phcs.filter((phc) => phc.mandal === campForm.mandalId) ?? [];
  const availableVillages = options?.villages.filter((village) =>
    village.mandal === campForm.mandalId && (!campForm.phcId || !village.phc || village.phc === campForm.phcId)
  ) ?? [];
  const staffCanCoordinate = user?.role === "doctor" || user?.role === "district_admin" || user?.role === "hospital_manager" || user?.role === "system_admin" || user?.role === "asha_worker";
  const canManageCamps = staffCanCoordinate && user?.role !== "asha_worker";

  return <>
    <SimulationBanner />
    <main className="mx-auto max-w-6xl space-y-6 px-4 pb-12 pt-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-bold uppercase tracking-wide text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">{t("phase10.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("phase10.description")}</p>
        </div>
        <div className="flex gap-2">
          <LanguageSwitcher />
          <Link className="min-h-touch rounded-lg border px-4 py-2 font-semibold" to={user?.role === "patient" ? "/patient-dashboard" : user?.role === "asha_worker" ? "/asha" : user?.role === "doctor" ? "/doctor" : user?.role === "hospital_manager" ? "/hospital-manager" : "/admin"}>{t("phase10.back")}</Link>
        </div>
      </header>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded-lg bg-green-50 p-3 text-green-900" role="status">{message}</p>}
      {loading ? <p role="status">{t("phase10.loading")}</p> : <>
        {staffCanCoordinate && <>
          {canManageCamps && <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="create-camp-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="create-camp-heading" className="text-xl font-bold">{t("phase10.newCamp")}</h2>
              {user?.role === "doctor" && <Link className="font-semibold text-medical-800 underline" to="/patient/new">{t("phase10.registerPatient")}</Link>}
            </div>
            <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => void submitCamp(event)}>
              <label className="font-semibold">{t("phase10.campTitle")}<input className={fieldClass} required minLength={2} maxLength={160} value={campForm.title} onChange={(event) => setCampForm({ ...campForm, title: event.target.value })} /></label>
              <label className="font-semibold">{t("phase10.startAt")}<input className={fieldClass} type="datetime-local" required value={campForm.startsAt} onChange={(event) => setCampForm({ ...campForm, startsAt: event.target.value })} /></label>
              <label className="font-semibold">{t("phase10.endAt")}<input className={fieldClass} type="datetime-local" required value={campForm.endsAt} onChange={(event) => setCampForm({ ...campForm, endsAt: event.target.value })} /></label>
              <label className="font-semibold">{t("phase10.mandal")}<select className={fieldClass} required value={campForm.mandalId} onChange={(event) => setCampForm({ ...campForm, mandalId: event.target.value, phcId: "", villageId: "" })}><option value="">{t("phase10.selectOne")}</option>{options?.mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{localizedName(mandal)}</option>)}</select></label>
              <label className="font-semibold">{t("phase10.phc")}<select className={fieldClass} required value={campForm.phcId} onChange={(event) => setCampForm({ ...campForm, phcId: event.target.value, villageId: "" })}><option value="">{t("phase10.selectOne")}</option>{availablePhcs.map((phc) => <option key={phc._id} value={phc._id}>{localizedName(phc)}</option>)}</select></label>
              <label className="font-semibold">{t("phase10.village")}<select className={fieldClass} required value={campForm.villageId} onChange={(event) => setCampForm({ ...campForm, villageId: event.target.value })}><option value="">{t("phase10.selectOne")}</option>{availableVillages.map((village) => <option key={village._id} value={village._id}>{localizedName(village)}</option>)}</select></label>
              <label className="font-semibold">{t("phase10.hospital")}<select className={fieldClass} value={campForm.hospitalId} disabled={user?.role === "hospital_manager"} onChange={(event) => setCampForm({ ...campForm, hospitalId: event.target.value })}><option value="">{t("phase10.selectOne")}</option>{options?.hospitals.map((hospital) => <option key={hospital._id} value={hospital._id}>{hospital.name}</option>)}</select></label>
              <label className="font-semibold">{t("phase10.assignedDoctors")}<select className={fieldClass} multiple value={selectedDoctors} onChange={(event) => setSelectedDoctors(Array.from(event.target.selectedOptions, (option) => option.value))}>{options?.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label>
              <button className="primary self-end" type="submit" disabled={saving}>{saving ? t("phase10.creating") : t("phase10.create")}</button>
            </form>
          </section>}
          <section className="space-y-4" aria-labelledby="camp-list-heading">
            <h2 id="camp-list-heading" className="text-2xl font-bold">{t("phase10.camps")}</h2>
            {camps.length === 0 && <p className="rounded-xl bg-white p-5 text-slate-600">{t("phase10.noCamps")}</p>}
            {camps.map((camp) => {
              const participant = participantFields[camp._id] ?? emptyParticipant;
              return <article key={camp._id} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold">{camp.title}</h3>
                    <p className="text-sm text-slate-600">{localizedName(camp.village)}, {localizedName(camp.mandal)} · {localizedName(camp.phc)}{camp.hospital ? ` · ${camp.hospital.name}` : ""}</p>
                    <p className="mt-1 text-sm">{t("phase10.startsEnds")}: {new Date(camp.startsAt).toLocaleString()} – {new Date(camp.endsAt).toLocaleString()}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{t(`phase10.status_${camp.status}`)}</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <p>{t("phase10.registered")}: {camp.totals.registered}</p>
                  <p>{t("phase10.attended")}: {camp.totals.attended}</p>
                  <p>{t("phase10.noShow")}: {camp.totals.noShow}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {camp.status === "planned" && <button className="min-h-touch rounded-lg bg-medical-700 px-4 py-2 font-bold text-white" type="button" onClick={() => void changeCampStatus(camp, "open")}>{t("phase10.openCamp")}</button>}
                  {camp.status === "open" && <button className="min-h-touch rounded-lg bg-medical-700 px-4 py-2 font-bold text-white" type="button" onClick={() => void changeCampStatus(camp, "completed")}>{t("phase10.completeCamp")}</button>}
                  {user?.role !== "asha_worker" && <button className="min-h-touch rounded-lg border px-4 py-2 font-bold" type="button" onClick={() => void downloadCampReport(camp._id, "csv").catch((requestError: unknown) => setError(getApiMessage(requestError, t("phase10.reportError"))))}>{t("phase10.exportReport")}</button>}
                  {user?.role !== "asha_worker" && <button className="min-h-touch rounded-lg border px-4 py-2 font-bold" type="button" onClick={() => void downloadCampReport(camp._id, "pdf").catch((requestError: unknown) => setError(getApiMessage(requestError, t("phase10.reportError"))))}>{t("phase10.exportPdf")}</button>}
                </div>
                {camp.status !== "completed" && camp.status !== "cancelled" && <div className="mt-5 grid gap-3 rounded-xl border p-4 md:grid-cols-3">
                  <h4 className="font-bold md:col-span-3">{t("phase10.registerParticipant")}</h4>
                  <label className="font-semibold">{t("phase10.patientRecordId")}<input className={fieldClass} required value={participant.patientId} onChange={(event) => updateParticipant(camp._id, "patientId", event.target.value)} /></label>
                  <label className="font-semibold">{t("phase10.caseRecordId")}<input className={fieldClass} value={participant.caseId} onChange={(event) => updateParticipant(camp._id, "caseId", event.target.value)} /></label>
                  <button className="primary self-end" type="button" onClick={() => void enrollParticipant(camp._id)}>{t("phase10.register")}</button>
                  {participant.participantId && <div className="flex flex-wrap gap-2 md:col-span-3"><span className="self-center text-sm">{participant.participantId}</span><button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" disabled={camp.status !== "open"} onClick={() => void markAttendance(camp._id, participant.participantId, "attended")}>{t("phase10.markAttended")}</button><button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" disabled={camp.status !== "open"} onClick={() => void markAttendance(camp._id, participant.participantId, "no_show")}>{t("phase10.markNoShow")}</button></div>}
                </div>}
              </article>;
            })}
          </section>
        </>}

        <section className="space-y-4" aria-labelledby="emergency-heading">
          <h2 id="emergency-heading" className="text-2xl font-bold">{t("phase10.emergency")}</h2>
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">{t("phase10.emergencyWarning")}</p>
          {isPatient && <div className="grid gap-4 lg:grid-cols-2">
            <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void sendSos(event)}>
              <label className="block font-semibold">{t("phase10.category")}<select className={fieldClass} value={emergencyForm.category} onChange={(event) => setEmergencyForm({ ...emergencyForm, category: event.target.value as EmergencyRequest["category"] })}>
                <option value="urgent_help">{t("phase10.urgentHelp")}</option><option value="transport">{t("phase10.transport")}</option><option value="other">{t("phase10.other")}</option>
              </select></label>
              <label className="block font-semibold">{t("phase10.message")}<textarea className={fieldClass} rows={3} minLength={1} maxLength={500} required value={emergencyForm.message} onChange={(event) => setEmergencyForm({ ...emergencyForm, message: event.target.value })} /></label>
              <fieldset className="space-y-3 rounded-xl border p-4">
                <legend className="px-1 font-bold">{t("phase10.emergencyContactTitle")}</legend>
                <p className="text-sm text-slate-600">{t("phase10.emergencyContactHint")}</p>
                <label className="block font-semibold">{t("phase10.emergencyContactName")}<input className={fieldClass} autoComplete="name" minLength={2} maxLength={100} value={emergencyForm.contactName} onChange={(event) => setEmergencyForm({ ...emergencyForm, contactName: event.target.value })} /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block font-semibold">{t("phase10.emergencyContactPhone")}<input className={fieldClass} type="tel" autoComplete="tel" minLength={7} maxLength={20} value={emergencyForm.contactPhone} onChange={(event) => setEmergencyForm({ ...emergencyForm, contactPhone: event.target.value })} /></label>
                  <label className="block font-semibold">{t("phase10.emergencyContactRelationship")}<input className={fieldClass} maxLength={80} value={emergencyForm.contactRelationship} onChange={(event) => setEmergencyForm({ ...emergencyForm, contactRelationship: event.target.value })} /></label>
                </div>
                <label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={emergencyForm.contactConsent} onChange={(event) => setEmergencyForm({ ...emergencyForm, contactConsent: event.target.checked })} /><span>{t("phase10.emergencyContactConsent")}</span></label>
              </fieldset>
              <button className="min-h-touch w-full rounded-lg bg-red-700 px-4 py-3 font-bold text-white" type="submit" disabled={saving}>{saving ? t("phase10.sending") : t("phase10.sendSos")}</button>
            </form>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="text-xl font-bold">{t("phase10.facilityDirectory")}</h3>
              <p className="mt-2 text-sm text-slate-600">{facilities?.notice}</p>
              <div className="mt-3 grid gap-2">{facilities?.facilities.map((facility) => <article key={facility.id} className="rounded-xl border p-3">
                <h4 className="font-bold">{facility.name}</h4>
                <p className="text-sm text-slate-600">{facility.type} · {facility.distanceKm === null ? "" : t("phase10.distance", { distance: facility.distanceKm })} · {t("phase10.availabilityUnknown")}</p>
                {facility.phone && <a className="font-semibold text-medical-800 underline" href={`tel:${facility.phone}`}>{facility.phone}</a>}
              </article>)}{facilities?.facilities.length === 0 && <p className="text-slate-600">{t("phase10.noFacilities")}</p>}</div>
            </div>
          </div>}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h3 className="text-xl font-bold">{t("phase10.requests")}</h3>
            {requests.length === 0 && <p className="mt-3 text-slate-600">{t("phase10.noRequests")}</p>}
            <div className="mt-3 grid gap-3">{requests.map((request) => <article key={request.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap justify-between gap-2"><p className="font-bold">{request.patientCode ?? request.category} · {t(`phase10.status_${request.status}`)}</p><p className="text-sm text-slate-600">{new Date(request.createdAt).toLocaleString()}</p></div>
              {request.message && <p className="mt-2 text-sm">{request.message}</p>}
              {request.resolutionNote && <p className="mt-2 text-sm">{t("phase10.emergencyResolution")}: {request.resolutionNote}</p>}
              {request.location && <a className="mt-2 inline-block font-semibold text-medical-800 underline" href={`https://www.openstreetmap.org/?mlat=${request.location.lat}&mlon=${request.location.lng}#map=16/${request.location.lat}/${request.location.lng}`} target="_blank" rel="noreferrer">Open consented location</a>}
              {staffCanCoordinate && request.contactAvailable && <section className="mt-3 rounded-lg bg-slate-50 p-3">
                <button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void revealEmergencyContact(request.id)}>{t("phase10.viewContact")}</button>
                {emergencyContacts[request.id] && <div className="mt-2 space-y-1">
                  <p>{emergencyContacts[request.id].name} · {emergencyContacts[request.id].relationship}</p>
                  <a className="font-semibold text-medical-800 underline" href={`tel:${emergencyContacts[request.id].phone}`}>{emergencyContacts[request.id].phone}</a>
                  <label className="block font-semibold">{t("phase10.attemptOutcome")}<select className={fieldClass} value={attemptOutcomes[request.id] ?? "reached"} onChange={(event) => setAttemptOutcomes((current) => ({ ...current, [request.id]: event.target.value as typeof attemptOutcomes[string] }))}>
                    <option value="reached">{t("phase10.reached")}</option><option value="no_answer">{t("phase10.noAnswer")}</option><option value="unavailable">{t("phase10.unavailable")}</option><option value="not_attempted">{t("phase10.notAttempted")}</option>
                  </select></label>
                  <button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void recordContactAttempt(request.id)}>{t("phase10.recordAttempt")}</button>
                </div>}
                {request.contactAttempts?.length ? <ul className="mt-3 space-y-1 text-sm">{request.contactAttempts.map((attempt) => <li key={`${attempt.attemptedAt}-${attempt.outcome}`}>{new Date(attempt.attemptedAt).toLocaleString()} · {attempt.channel} · {t(`phase10.${attempt.outcome === "no_answer" ? "noAnswer" : attempt.outcome === "not_attempted" ? "notAttempted" : attempt.outcome}`)}</li>)}</ul> : null}
                <label className="mt-3 block font-semibold">{t("phase10.escalationReason")}<textarea className={fieldClass} maxLength={500} value={escalationReasons[request.id] ?? ""} onChange={(event) => setEscalationReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></label>
                <button className="mt-2 min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void escalateRequest(request.id)}>{t("phase10.escalate")}</button>
                {request.escalations?.length ? <ul className="mt-3 space-y-1 text-sm">{request.escalations.map((entry) => <li key={`${entry.escalatedAt}-${entry.reason}`}>{new Date(entry.escalatedAt).toLocaleString()} · {entry.reason}</li>)}</ul> : null}
              </section>}
              {isPatient && ["open", "assigned"].includes(request.status) && <button className="mt-3 min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void cancelSos(request.id)}>{t("phase10.cancel")}</button>}
              {staffCanCoordinate && <div className="mt-3 flex flex-wrap gap-2">
                {request.status === "open" && user?.role === "doctor" && <button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void updateRequest(request, "assigned")}>{t("phase10.assign")}</button>}
                {request.status === "open" && user?.role !== "doctor" && <><select aria-label={t("phase10.assignDoctor")} className="min-h-touch rounded-lg border px-3" value={assignees[request.id] ?? ""} onChange={(event) => setAssignees((current) => ({ ...current, [request.id]: event.target.value }))}><option value="">{t("phase10.assignDoctor")}</option>{options?.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select><button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void updateRequest(request, "assigned")}>{t("phase10.assign")}</button></>}
                {(request.status === "assigned" && (user?.role !== "doctor" || request.assignedTo === user.id)) && <button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void updateRequest(request, "acknowledged")}>{t("phase10.acknowledge")}</button>}
                {request.status === "acknowledged" && (user?.role !== "doctor" || request.assignedTo === user.id) && <><label className="block font-semibold">{t("phase10.emergencyResolution")}<textarea className={fieldClass} maxLength={500} value={resolutionNotes[request.id] ?? ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [request.id]: event.target.value }))} /></label><button className="min-h-touch rounded-lg border px-3 py-2 font-semibold" type="button" onClick={() => void updateRequest(request, "resolved")}>{t("phase10.resolve")}</button></>}
              </div>}
            </article>)}</div>
          </div>
        </section>
      </>}
    </main>
  </>;
}
