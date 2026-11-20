import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";
import { getApiMessage } from "../auth/api";
import { getCamps, recordCampAttendance, registerCampParticipant, type Camp } from "../community/communityApi";
import {
  getAshaActivityReport,
  getAshaCampParticipants,
  getAshaDashboard,
  getAshaPatientHistory,
  getAssignedAshaPatients,
  grantAshaScreeningConsent,
  recordAshaVisit,
  registerAshaPatient,
  type AshaCampParticipant,
  type AshaPatient
} from "./ashaApi";

const fieldClass = "mt-1 min-h-touch w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const text = {
  en: {
    title: "ASHA worker portal", subtitle: "Assigned community care and follow-up", patients: "Assigned patients", due: "Follow-ups due",
    visits: "Visits in 30 days", referrals: "Pending referrals", register: "Register patient", name: "Patient name", phone: "Mobile number",
    age: "Age", address: "Address", phc: "Assigned PHC", village: "Assigned village", language: "Preferred language",
    registrationConsent: "Patient agreed to registration and data storage", screeningConsent: "Patient also agreed to screening",
    savePatient: "Save patient", patientList: "Your assigned patients", choosePatient: "Select a patient", patient: "Patient",
    history: "Care history", screenings: "Screenings", followUps: "Follow-ups", referralsList: "Referrals", visitsList: "Visits",
    campsList: "Health camps", chooseCamp: "Select a camp", registerCamp: "Register patient for camp", campConsent: "Patient agreed to screening at this camp",
    attendance: "Camp attendance", markPresent: "Mark attended", markAbsent: "Mark not attended", activity: "My activity report",
    loadReport: "Load report", visitForm: "Record a patient visit", outcome: "Visit outcome", contacted: "Contacted",
    not_available: "Not available", follow_up_needed: "Follow-up needed", referred: "Referred", nextFollowUp: "Next follow-up date",
    notes: "Visit notes", saveVisit: "Save visit", empty: "No assigned patients found.", noCamps: "No camps are scheduled in your assigned area.",
    logout: "Log out", loading: "Loading…", save: "Saving…", error: "Unable to load ASHA information.",
    consentNeeded: "Explicit patient consent is required before screening or camp registration.", successPatient: "Patient registered.",
    successVisit: "Visit recorded.", successCamp: "Patient registered for the camp.", successConsent: "Screening consent recorded.",
    historyError: "Unable to load this patient history.", reportVisits: "Recorded visits", reportUpcoming: "Upcoming follow-ups",
    participant: "Participant", registrationRequired: "Confirm patient registration consent to continue.", reportError: "Unable to load the activity report.",
    simulations: "Simulation only · Not for clinical use", emergency: "Emergency coordination"
  },
  te: {
    title: "ఆశా కార్యకర్త పోర్టల్", subtitle: "కేటాయించిన సమాజ సంరక్షణ మరియు తదుపరి పర్యవేక్షణ", patients: "కేటాయించిన రోగులు", due: "పెండింగ్ తదుపరి సందర్శనలు",
    visits: "30 రోజుల్లో సందర్శనలు", referrals: "పెండింగ్ రిఫరల్స్", register: "రోగిని నమోదు చేయండి", name: "రోగి పేరు", phone: "మొబైల్ నంబర్",
    age: "వయస్సు", address: "చిరునామా", phc: "కేటాయించిన పీహెచ్‌సీ", village: "కేటాయించిన గ్రామం", language: "ఇష్టమైన భాష",
    registrationConsent: "నమోదు మరియు సమాచార నిల్వకు రోగి అంగీకరించారు", screeningConsent: "స్క్రీనింగ్‌కు కూడా రోగి అంగీకరించారు",
    savePatient: "రోగిని భద్రపరచండి", patientList: "మీకు కేటాయించిన రోగులు", choosePatient: "రోగిని ఎంచుకోండి", patient: "రోగి",
    history: "సంరక్షణ చరిత్ర", screenings: "స్క్రీనింగ్‌లు", followUps: "తదుపరి సందర్శనలు", referralsList: "రిఫరల్స్", visitsList: "సందర్శనలు",
    campsList: "ఆరోగ్య శిబిరాలు", chooseCamp: "శిబిరాన్ని ఎంచుకోండి", registerCamp: "శిబిరానికి రోగిని నమోదు చేయండి", campConsent: "ఈ శిబిరంలో స్క్రీనింగ్‌కు రోగి అంగీకరించారు",
    attendance: "శిబిర హాజరు", markPresent: "హాజరైనట్లు గుర్తించండి", markAbsent: "హాజరు కాలేదని గుర్తించండి", activity: "నా కార్యకలాప నివేదిక",
    loadReport: "నివేదికను తెరవండి", visitForm: "రోగి సందర్శనను నమోదు చేయండి", outcome: "సందర్శన ఫలితం", contacted: "సంప్రదించారు",
    not_available: "అందుబాటులో లేరు", follow_up_needed: "తదుపరి సందర్శన అవసరం", referred: "రిఫర్ చేశారు", nextFollowUp: "తదుపరి సందర్శన తేదీ",
    notes: "సందర్శన గమనికలు", saveVisit: "సందర్శనను భద్రపరచండి", empty: "కేటాయించిన రోగులు లేరు.", noCamps: "మీ ప్రాంతంలో శిబిరాలు లేవు.",
    logout: "లాగ్ అవుట్", loading: "లోడ్ అవుతోంది…", save: "భద్రపరుస్తోంది…", error: "ఆశా సమాచారం లోడ్ చేయలేకపోయాం.",
    consentNeeded: "స్క్రీనింగ్ లేదా శిబిర నమోదు ముందు రోగి స్పష్టమైన సమ్మతి అవసరం.", successPatient: "రోగి నమోదు అయ్యారు.",
    successVisit: "సందర్శన నమోదు అయ్యింది.", successCamp: "రోగి శిబిరానికి నమోదు అయ్యారు.", successConsent: "స్క్రీనింగ్ సమ్మతి నమోదు అయ్యింది.",
    historyError: "రోగి చరిత్ర లోడ్ కాలేదు.", reportVisits: "నమోదైన సందర్శనలు", reportUpcoming: "రాబోయే తదుపరి సందర్శనలు",
    participant: "పాల్గొనేవారు", registrationRequired: "కొనసాగడానికి రోగి నమోదు సమ్మతిని నిర్ధారించండి.", reportError: "కార్యకలాప నివేదిక లోడ్ కాలేదు.",
    simulations: "అనుకరణ మాత్రమే · వైద్య వినియోగానికి కాదు", emergency: "అత్యవసర సమన్వయం"
  },
  hi: {
    title: "आशा कार्यकर्ता पोर्टल", subtitle: "निर्धारित सामुदायिक देखभाल और अनुवर्ती कार्य", patients: "निर्धारित मरीज", due: "लंबित फॉलो-अप",
    visits: "30 दिनों में दौरे", referrals: "लंबित रेफरल", register: "मरीज पंजीकृत करें", name: "मरीज का नाम", phone: "मोबाइल नंबर",
    age: "आयु", address: "पता", phc: "निर्धारित पीएचसी", village: "निर्धारित गांव", language: "पसंदीदा भाषा",
    registrationConsent: "मरीज ने पंजीकरण और डेटा संग्रह पर सहमति दी", screeningConsent: "मरीज ने स्क्रीनिंग पर भी सहमति दी",
    savePatient: "मरीज सहेजें", patientList: "आपके निर्धारित मरीज", choosePatient: "मरीज चुनें", patient: "मरीज",
    history: "देखभाल इतिहास", screenings: "स्क्रीनिंग", followUps: "फॉलो-अप", referralsList: "रेफरल", visitsList: "दौरे",
    campsList: "स्वास्थ्य शिविर", chooseCamp: "शिविर चुनें", registerCamp: "शिविर के लिए मरीज पंजीकृत करें", campConsent: "मरीज ने इस शिविर में स्क्रीनिंग पर सहमति दी",
    attendance: "शिविर उपस्थिति", markPresent: "उपस्थित चिह्नित करें", markAbsent: "अनुपस्थित चिह्नित करें", activity: "मेरी गतिविधि रिपोर्ट",
    loadReport: "रिपोर्ट खोलें", visitForm: "मरीज का दौरा दर्ज करें", outcome: "दौरे का परिणाम", contacted: "संपर्क किया",
    not_available: "उपलब्ध नहीं", follow_up_needed: "फॉलो-अप आवश्यक", referred: "रेफर किया", nextFollowUp: "अगली फॉलो-अप तारीख",
    notes: "दौरे के नोट्स", saveVisit: "दौरा सहेजें", empty: "कोई निर्धारित मरीज नहीं मिला।", noCamps: "आपके क्षेत्र में कोई शिविर निर्धारित नहीं है।",
    logout: "लॉग आउट", loading: "लोड हो रहा है…", save: "सहेजा जा रहा है…", error: "आशा जानकारी लोड नहीं हो सकी।",
    consentNeeded: "स्क्रीनिंग या शिविर पंजीकरण से पहले मरीज की स्पष्ट सहमति आवश्यक है।", successPatient: "मरीज पंजीकृत हुआ।",
    successVisit: "दौरा दर्ज हुआ।", successCamp: "मरीज शिविर के लिए पंजीकृत हुआ।", successConsent: "स्क्रीनिंग सहमति दर्ज हुई।",
    historyError: "मरीज का इतिहास लोड नहीं हो सका।", reportVisits: "दर्ज दौरे", reportUpcoming: "आगामी फॉलो-अप",
    participant: "प्रतिभागी", registrationRequired: "जारी रखने के लिए मरीज की पंजीकरण सहमति की पुष्टि करें।", reportError: "गतिविधि रिपोर्ट लोड नहीं हो सकी।",
    simulations: "केवल सिमुलेशन · नैदानिक उपयोग के लिए नहीं", emergency: "आपातकालीन समन्वय"
  }
} as const;

export default function AshaDashboard() {
  const { user, logout } = useAuth();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const language = (user?.language ?? i18n.resolvedLanguage ?? "en").split("-")[0] as keyof typeof text;
  const copy = text[language] ?? text.en;
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getAshaDashboard>>>();
  const [patients, setPatients] = useState<AshaPatient[]>([]);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getAshaPatientHistory>>>();
  const [participants, setParticipants] = useState<Record<string, AshaCampParticipant[]>>({});
  const [selectedCampId, setSelectedCampId] = useState("");
  const [campPatientId, setCampPatientId] = useState("");
  const [report, setReport] = useState<Awaited<ReturnType<typeof getAshaActivityReport>>>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState({
    name: "", phone: "", ageYears: "", address: "", phcId: "", villageId: "", preferredLanguage: language as "en" | "te" | "hi",
    registrationConsent: false, screeningConsent: false
  });
  const [visit, setVisit] = useState({ outcome: "contacted" as "contacted" | "not_available" | "follow_up_needed" | "referred", nextFollowUpAt: "", notes: "" });
  const [campConsent, setCampConsent] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextDashboard, nextPatients, nextCamps] = await Promise.all([getAshaDashboard(), getAssignedAshaPatients(), getCamps()]);
      setDashboard(nextDashboard);
      setPatients(nextPatients);
      setCamps(nextCamps);
      setRegistration((current) => ({
        ...current,
        phcId: current.phcId || nextDashboard.phcs[0]?._id || "",
        villageId: current.villageId || nextDashboard.villages[0]?._id || "",
        preferredLanguage: language
      }));
      setSelectedCampId((current) => current || nextCamps[0]?._id || "");
    } catch (requestError) {
      setError(getApiMessage(requestError, copy.error));
    } finally {
      setLoading(false);
    }
  }, [copy.error, language]);

  useEffect(() => { void refresh(); }, [refresh]);

  const patientMap = useMemo(() => new Map(patients.map((item) => [item._id ?? item.id ?? "", item])), [patients]);
  const villages = dashboard?.villages.filter((village) => !registration.phcId || village.phc === registration.phcId) ?? [];

  async function loadHistory(patientId: string) {
    setSelectedPatientId(patientId);
    setError("");
    setHistory(undefined);
    if (!patientId) return;
    try { setHistory(await getAshaPatientHistory(patientId)); }
    catch (requestError) { setError(getApiMessage(requestError, copy.historyError)); }
  }

  async function submitRegistration(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!registration.registrationConsent) { setError(copy.registrationRequired); return; }
    setBusy(true);
    try {
      const patient = await registerAshaPatient({
        name: registration.name, phone: registration.phone.trim(),
        ageYears: Number(registration.ageYears),
        address: registration.address || undefined, phcId: registration.phcId, villageId: registration.villageId,
        preferredLanguage: registration.preferredLanguage, registrationConsent: true, screeningConsent: registration.screeningConsent
      });
      setNotice(copy.successPatient);
      setRegistration((current) => ({ ...current, name: "", phone: "", ageYears: "", address: "", registrationConsent: false, screeningConsent: false }));
      await refresh();
      const patientId = patient._id ?? patient.id ?? "";
      if (patientId) await loadHistory(patientId);
    } catch (requestError) { setError(getApiMessage(requestError, copy.error)); }
    finally { setBusy(false); }
  }

  async function submitVisit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPatientId) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await recordAshaVisit(selectedPatientId, {
        outcome: visit.outcome,
        nextFollowUpAt: visit.nextFollowUpAt ? new Date(`${visit.nextFollowUpAt}T12:00:00`).toISOString() : undefined,
        notes: visit.notes || undefined
      });
      setNotice(copy.successVisit);
      setVisit({ outcome: "contacted", nextFollowUpAt: "", notes: "" });
      await Promise.all([loadHistory(selectedPatientId), refresh()]);
    } catch (requestError) { setError(getApiMessage(requestError, copy.error)); }
    finally { setBusy(false); }
  }

  async function submitCampRegistration(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCampId || !campPatientId) return;
    setError("");
    setNotice("");
    if (!campConsent) { setError(copy.consentNeeded); return; }
    setBusy(true);
    try {
      await grantAshaScreeningConsent(campPatientId);
      await registerCampParticipant(selectedCampId, campPatientId);
      setNotice(copy.successCamp);
      setCampConsent(false);
      await loadCampParticipants(selectedCampId);
    } catch (requestError) { setError(getApiMessage(requestError, copy.error)); }
    finally { setBusy(false); }
  }

  async function loadCampParticipants(campId: string) {
    if (!campId) return;
    try {
      const rows = await getAshaCampParticipants(campId);
      setParticipants((current) => ({ ...current, [campId]: rows }));
    } catch (requestError) { setError(getApiMessage(requestError, copy.error)); }
  }

  async function markAttendance(participantId: string, status: "attended" | "no_show") {
    if (!selectedCampId) return;
    setError("");
    setBusy(true);
    try {
      await recordCampAttendance(selectedCampId, participantId, status);
      await loadCampParticipants(selectedCampId);
    } catch (requestError) { setError(getApiMessage(requestError, copy.error)); }
    finally { setBusy(false); }
  }

  async function loadReport() {
    setError("");
    try { setReport(await getAshaActivityReport()); }
    catch (requestError) { setError(getApiMessage(requestError, copy.reportError)); }
  }

  const selectedPatient = patientMap.get(selectedPatientId);
  const selectedCamp = camps.find((camp) => camp._id === selectedCampId);

  return <div className="min-h-screen bg-medical-50">
    <SimulationBanner />
    <main className="mx-auto max-w-7xl px-4 pb-10 pt-24">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{copy.title}</h1><p className="mt-1 text-slate-600">{copy.subtitle}</p></div>
        <div className="flex items-center gap-2"><LanguageSwitcher /><button className="min-h-touch rounded-lg border px-3" type="button" onClick={() => navigate("/community")}>{copy.emergency}</button><button className="min-h-touch rounded-lg border px-3" type="button" onClick={async () => { await logout(); navigate("/login?role=asha_worker"); }}>{copy.logout}</button></div>
      </header>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-green-50 p-3 text-green-900" role="status">{notice}</p>}
      {loading ? <p className="rounded-xl bg-white p-5" role="status">{copy.loading}</p> : <>
        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={copy.title}>
          {[[copy.patients, dashboard?.summary.patients], [copy.due, dashboard?.summary.dueVisits], [copy.visits, dashboard?.summary.visitsLast30Days], [copy.referrals, dashboard?.summary.pendingReferrals]].map(([label, count]) =>
            <article key={String(label)} className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold text-medical-800">{count ?? 0}</p></article>
          )}
        </section>

        <section className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void submitRegistration(event)}>
            <h2 className="text-xl font-bold">{copy.register}</h2>
            <label className="block font-semibold">{copy.name}<input className={fieldClass} autoComplete="name" minLength={2} maxLength={200} required value={registration.name} onChange={(event) => setRegistration({ ...registration, name: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block font-semibold">{copy.phone}<input className={fieldClass} type="tel" autoComplete="tel" minLength={7} maxLength={20} required value={registration.phone} onChange={(event) => setRegistration({ ...registration, phone: event.target.value })} /></label>
              <label className="block font-semibold">{copy.age}<input className={fieldClass} type="number" min={0} max={120} required value={registration.ageYears} onChange={(event) => setRegistration({ ...registration, ageYears: event.target.value })} /></label>
            </div>
            <label className="block font-semibold">{copy.address}<input className={fieldClass} maxLength={500} value={registration.address} onChange={(event) => setRegistration({ ...registration, address: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block font-semibold">{copy.phc}<select className={fieldClass} required value={registration.phcId} onChange={(event) => setRegistration({ ...registration, phcId: event.target.value, villageId: "" })}><option value="">{copy.choosePatient}</option>{dashboard?.phcs.map((item) => <option value={item._id} key={item._id}>{item.name_en ?? item.name}</option>)}</select></label>
              <label className="block font-semibold">{copy.village}<select className={fieldClass} required value={registration.villageId} onChange={(event) => setRegistration({ ...registration, villageId: event.target.value })}><option value="">{copy.choosePatient}</option>{villages.map((item) => <option value={item._id} key={item._id}>{item.name_en ?? item.name}</option>)}</select></label>
            </div>
            <label className="block font-semibold">{copy.language}<select className={fieldClass} value={registration.preferredLanguage} onChange={(event) => setRegistration({ ...registration, preferredLanguage: event.target.value as "en" | "te" | "hi" })}><option value="te">తెలుగు</option><option value="en">English</option><option value="hi">हिन्दी</option></select></label>
            <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3"><input className="mt-1" type="checkbox" required checked={registration.registrationConsent} onChange={(event) => setRegistration({ ...registration, registrationConsent: event.target.checked })} /><span>{copy.registrationConsent}</span></label>
            <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3"><input className="mt-1" type="checkbox" checked={registration.screeningConsent} onChange={(event) => setRegistration({ ...registration, screeningConsent: event.target.checked })} /><span>{copy.screeningConsent}</span></label>
            <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="submit" disabled={busy || !registration.phcId || !registration.villageId}>{busy ? copy.save : copy.savePatient}</button>
          </form>

          <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">{copy.patientList}</h2>
            <label className="block font-semibold">{copy.patient}<select className={fieldClass} value={selectedPatientId} onChange={(event) => void loadHistory(event.target.value)}><option value="">{copy.choosePatient}</option>{patients.map((patient) => <option value={patient._id ?? patient.id} key={patient._id ?? patient.id}>{patient.name}</option>)}</select></label>
            {patients.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-slate-600">{copy.empty}</p>}
            {selectedPatient && <form className="space-y-3 rounded-xl border p-4" onSubmit={(event) => void submitVisit(event)}>
              <h3 className="font-bold">{copy.visitForm}: {selectedPatient.name}</h3>
              <label className="block font-semibold">{copy.outcome}<select className={fieldClass} value={visit.outcome} onChange={(event) => setVisit({ ...visit, outcome: event.target.value as typeof visit.outcome })}>{(["contacted", "not_available", "follow_up_needed", "referred"] as const).map((outcome) => <option value={outcome} key={outcome}>{copy[outcome]}</option>)}</select></label>
              <label className="block font-semibold">{copy.nextFollowUp}<input className={fieldClass} type="date" min={new Date().toISOString().slice(0, 10)} value={visit.nextFollowUpAt} onChange={(event) => setVisit({ ...visit, nextFollowUpAt: event.target.value })} /></label>
              <label className="block font-semibold">{copy.notes}<textarea className={fieldClass} maxLength={2000} rows={2} value={visit.notes} onChange={(event) => setVisit({ ...visit, notes: event.target.value })} /></label>
              <button className="min-h-touch rounded-xl bg-medical-700 px-4 font-bold text-white disabled:opacity-60" disabled={busy} type="submit">{busy ? copy.save : copy.saveVisit}</button>
            </form>}
            {history && <div className="space-y-3">
              <h3 className="font-bold">{copy.history}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <HistoryList title={copy.screenings} rows={history.screenings.map((item) => `${item.status} · ${new Date(item.createdAt).toLocaleDateString()}`)} />
                <HistoryList title={copy.followUps} rows={history.followUps.map((item) => `${item.status} · ${new Date(item.scheduledAt).toLocaleDateString()}`)} />
                <HistoryList title={copy.referralsList} rows={history.referrals.map((item) => `${item.status} · ${item.priority}${item.specialty ? ` · ${item.specialty}` : ""}`)} />
                <HistoryList title={copy.visitsList} rows={history.visits.map((item) => `${copy[item.outcome]} · ${new Date(item.visitedAt).toLocaleDateString()}`)} />
              </div>
            </div>}
          </section>
        </section>

        <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-xl font-bold">{copy.campsList}</h2>
          {camps.length === 0 ? <p className="text-slate-600">{copy.noCamps}</p> : <>
            <form className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => void submitCampRegistration(event)}>
              <label className="block font-semibold">{copy.chooseCamp}<select className={fieldClass} value={selectedCampId} onChange={(event) => { setSelectedCampId(event.target.value); setCampPatientId(""); void loadCampParticipants(event.target.value); }}><option value="">{copy.chooseCamp}</option>{camps.map((camp) => <option value={camp._id} key={camp._id}>{camp.title} · {camp.village.name_en ?? camp.village.name}</option>)}</select></label>
              <label className="block font-semibold">{copy.patient}<select className={fieldClass} value={campPatientId} onChange={(event) => setCampPatientId(event.target.value)}><option value="">{copy.choosePatient}</option>{patients.map((item) => <option key={item._id ?? item.id} value={item._id ?? item.id}>{item.name}</option>)}</select></label>
              <button className="min-h-touch self-end rounded-xl bg-medical-700 px-4 font-bold text-white disabled:opacity-60" disabled={busy || selectedCamp?.status !== "open" || !campPatientId} type="submit">{busy ? copy.save : copy.registerCamp}</button>
              <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 md:col-span-3"><input className="mt-1" type="checkbox" checked={campConsent} onChange={(event) => setCampConsent(event.target.checked)} /><span>{copy.campConsent}</span></label>
            </form>
            {selectedCamp && <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{copy.attendance}: {selectedCamp.title}</h3><button className="min-h-touch rounded-lg border px-3" type="button" onClick={() => void loadCampParticipants(selectedCampId)}>{copy.activity}</button></div>
              {(participants[selectedCampId] ?? []).map((participant) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={participant.id}>
                <span>{patientMap.get(participant.patientId)?.name ?? copy.participant} · {participant.status}</span>
                {participant.status === "registered" && <div className="flex gap-2"><button className="min-h-touch rounded-lg border px-3" disabled={busy || selectedCamp.status !== "open"} type="button" onClick={() => void markAttendance(participant.id, "attended")}>{copy.markPresent}</button><button className="min-h-touch rounded-lg border px-3" disabled={busy || selectedCamp.status !== "open"} type="button" onClick={() => void markAttendance(participant.id, "no_show")}>{copy.markAbsent}</button></div>}
              </div>)}
            </div>}
          </>}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{copy.activity}</h2><button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => void loadReport()}>{copy.loadReport}</button></div>
          {report && <div className="mt-4 flex flex-wrap gap-6"><p>{copy.reportVisits}: <strong>{report.totalVisits}</strong></p><p>{copy.reportUpcoming}: <strong>{report.upcomingFollowUps}</strong></p></div>}
        </section>
      </>}
    </main>
  </div>;
}

function HistoryList({ title, rows }: { title: string; rows: string[] }) {
  return <section className="rounded-lg bg-slate-50 p-3"><h4 className="mb-2 font-semibold">{title}</h4>{rows.length ? <ul className="space-y-1 text-sm text-slate-700">{rows.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}</ul> : <p className="text-sm text-slate-500">—</p>}</section>;
}
