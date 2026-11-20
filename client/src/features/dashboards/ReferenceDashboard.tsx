import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { useAuth } from "../auth/AuthProvider";
import api, { getApiMessage } from "../auth/api";
import { getDashboardSummary, type DashboardSummary } from "../admin/dashboardApi";
import { getMandals, type Mandal } from "../admin/adminApi";
import { getPatientProfile, getPatientRecords } from "../patient/patientApi";
import PatientCareSummary from "../patient/PatientCareSummary";
import { syncNow, totalPendingCount } from "../../offline/sync";
import "./referenceDashboard.css";
import "./referenceDashboardPolish.css";

const refreshIntervalMs = 30_000;

type PersonalCounts = { records: number; appointments: number; plans: number };
type AppointmentRow = { status?: string };
type PlanRow = { status?: string };
type NotificationRow = { _id: string; template: string; status: string; createdAt: string };
type SearchPatient = { _id: string; name: string; patientCode?: string };
type DashboardCardProps = {
  className?: string;
  icon: string;
  title: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
};
function DashboardCard({ className = "", icon, title, children, action }: DashboardCardProps) {
  return <section className={`rd-card ${className}`}>
    <header className="rd-card-heading"><span className="rd-card-icon" aria-hidden="true">{icon}</span><h2>{title}</h2></header>
    <div className="rd-card-body">{children}</div>
    {action && <button className="rd-card-action" type="button" onClick={action.onClick}>{action.label}<span aria-hidden="true">→</span></button>}
  </section>;
}

export default function ReferenceDashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary>();
  const [mandals, setMandals] = useState<Mandal[]>([]);
  const [selectedMandal, setSelectedMandal] = useState("");
  const [personal, setPersonal] = useState<PersonalCounts>();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [loadingData, setLoadingData] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<SearchPatient[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const admin = user?.role === "district_admin" || user?.role === "system_admin";
  const careTeam = user?.role === "doctor";
  const language = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
  const isTelugu = language === "te";

  const labels = useMemo(() => isTelugu ? {
    welcome: "తిరిగి స్వాగతం", priority: "మీ ఆరోగ్యం, మా ప్రాధాన్యత", assistant: "దృష్టి సహాయకుడు",
    communityDashboard: "సమాజ ఆరోగ్య డాష్‌బోర్డ్", platform: "నోటి క్యాన్సర్ స్క్రీనింగ్ వేదిక",
    heroTagline: "ముందుగా గుర్తించండి... నోటి క్యాన్సర్‌ను నివారించండి...",
    heroMotto: "ఆరోగ్యకరమైన రేపటి కోసం కలిసి",
    earlyScreening: "ముందస్తు స్క్రీనింగ్", savesLives: "ప్రాణాలను కాపాడుతుంది",
    overviewTitle: "నోటి ఆరోగ్య అవలోకనం", mandalStatsTitle: "మండలాల వారీ గణాంకాలు",
    recentActivityTitle: "ఇటీవలి కార్యకలాపాలు", selectMandal: "మండలాన్ని ఎంచుకోండి",
    allMandals: "అన్ని మండలాలు", mandalsAvailable: "మండలాలు అందుబాటులో ఉన్నాయి",
    viewAll: "అన్నీ చూడండి", noRecentActivity: "ఇటీవలి కార్యకలాపాలు లేవు.",
    currentFigures: "ప్రస్తుత గణాంకాలు మీ ఖాతా నుండి చూపబడతాయి.",
    signInLiveStats: "ప్రత్యక్ష డేటా చూడటానికి సైన్ ఇన్ చేయండి",
    quickAccess: "త్వరిత ప్రాప్యత", awareness: "నోటి క్యాన్సర్ అవగాహన",
    awarenessTitle: "పరిశీలించండి. నివారించండి. ఆరోగ్యంగా జీవించండి.",
    awarenessDescription: "లక్షణాలను తెలుసుకోండి. అర్హత కలిగిన సంరక్షణ బృందాన్ని సంప్రదించండి.",
    learnMore: "మరింత తెలుసుకోండి", footerCopyright: "© ఆరోగ్య దృష్టి · సమాజ నోటి ఆరోగ్యం",
    footerLanguages: "తెలుగు · English · हिंदी",
    notifications: "నోటిఫికేషన్‌లు", markRead: "చదివినట్లు గుర్తించండి",
    noNotifications: "నోటిఫికేషన్‌లు లేవు.", closeNotifications: "నోటిఫికేషన్‌లను మూసివేయండి",
    patientSearch: "రోగులు, మండలాలు, గ్రామాలు వెతకండి...", mandalSearch: "మండలాలను వెతకండి...",
    patientRecord: "రోగి రికార్డు", mandal: "మండలం", noSearchResults: "సరిపోలే రోగులు లేదా మండలాలు లేవు.",
    workspace: "పని ప్రదేశం", oralModules: "నోటి ఆరోగ్య విభాగాలు", yourAccount: "మీ ఖాతా",
    oralRecords: "నోటి పరీక్ష రికార్డులు", aiResults: "AI స్క్రీనింగ్ ఫలితాలు",
    healthyMouth: "ఆరోగ్యకరమైన నోరు", healthyLife: "ఆరోగ్యకరమైన జీవితం",
    callHelpline: "హెల్ప్‌లైన్ 104కు కాల్ చేయండి", simulationOnly: "అనుకరణ మాత్రమే · వైద్య వినియోగానికి కాదు",
    readStatus: "చదివారు", unreadStatus: "చదవలేదు",
    dashboard: "డాష్‌బోర్డ్", doctorDashboard: "వైద్యుల డాష్‌బోర్డ్", patientDashboard: "రోగి డాష్‌బోర్డ్",
    mandalManagement: "మండల నిర్వహణ", villageManagement: "గ్రామ నిర్వహణ", mandalNavigator: "మండల నావిగేటర్",
    clinicalWorkspace: "వైద్య పని ప్రదేశం", assistantNav: "AI సహాయకుడు", oral: "నోటి ఆరోగ్య స్క్రీనింగ్",
    tobacco: "పొగాకు మాన్పు సహాయం", nutrition: "పోషకాహార మార్గదర్శి", healthCard: "ఆరోగ్య కార్డు",
    navigator: "మండల నావిగేటర్", appointments: "డాక్టర్ అపాయింట్‌మెంట్", reports: "వైద్య రికార్డులు",
    settings: "సెట్టింగ్‌లు", quick: "త్వరిత చర్యలు", register: "రోగి నమోదు", profile: "నా ప్రొఫైల్", scan: "హెల్త్ కార్డ్",
    check: "స్క్రీనింగ్ ప్రారంభించండి", book: "అపాయింట్‌మెంట్", coverage: "మండలాల కవరేజ్",
    records: "వైద్య రికార్డులు", synced: "ఆఫ్‌లైన్ సమకాలీకరణ", view: "చూడండి", signIn: "సైన్ ఇన్",
    signInPrompt: "వ్యక్తిగత సమాచారం మరియు డాష్‌బోర్డ్ గణాంకాలు చూడటానికి సైన్ ఇన్ చేయండి.",
    signInRequired: "ఈ వివరాలు చూడటానికి మీ ఖాతాలోకి సైన్ ఇన్ చేయండి.",
    mapDataUnavailable: "మండలాల డేటా అందుబాటులో లేదు.", saved: "సేవ్ చేసిన డేటా",
    syncedState: "సమకాలీకరించబడింది", syncing: "సమకాలీకరిస్తోంది", retry: "ఇప్పుడే సమకాలీకరించండి",
    noPending: "సమకాలీకరణకు పెండింగ్ డేటా లేదు", pending: "పెండింగ్ అంశాలు",
    startAssistant: "దృష్టితో మాట్లాడండి", assistantPrompt: "మీ సంరక్షణ బృందంతో కలవండి లేదా ఆరోగ్య మార్గదర్శకాలను అడగండి.",
    adminStats: "నిజ సమయ జిల్లా గణాంకాలు", patientStats: "మీ సంరక్షణ సారాంశం",
    registerAction: "రోగిని నమోదు చేయండి", recordsAction: "రికార్డులు చూడండి",
    noMandal: "మండల డేటా లేదు", loading: "డేటా లోడ్ అవుతోంది…", liveUpdated: "ప్రత్యక్ష డేటా నవీకరణ",
    patients: "అర్హులైన పెద్దలు", screened: "స్క్రీనింగ్ చేసినవారు",
    coverageRate: "స్క్రీనింగ్ కవరేజ్", images: "అంచనా వేసిన చిత్రాలు",
    appointmentsCount: "అపాయింట్‌మెంట్‌లు", plans: "చురుకైన మాన్పు ప్రణాళికలు",
    recordsCount: "వైద్య నివేదికలు", mandalsCount: "మండలాలు"
  } : {
    welcome: "Welcome back", priority: "Your health, our priority", assistant: "Drishti AI assistant",
    communityDashboard: "Community health dashboard", platform: "ORAL CANCER SCREENING PLATFORM",
    heroTagline: "Detect Early... Prevent Oral Cancer...",
    heroMotto: "Together for a Healthier Tomorrow",
    earlyScreening: "Early Screening", savesLives: "Saves Lives",
    overviewTitle: "Oral Health Overview", mandalStatsTitle: "Mandal-wise Statistics",
    recentActivityTitle: "Recent Activity", selectMandal: "Select mandal",
    allMandals: "All mandals", mandalsAvailable: "mandals available",
    viewAll: "View all", noRecentActivity: "No recent activity yet.",
    currentFigures: "Current figures are shown from your live account data.",
    signInLiveStats: "Sign in to view live data",
    quickAccess: "Quick Access", awareness: "ORAL CANCER AWARENESS",
    awarenessTitle: "Check. Prevent. Live Healthy.",
    awarenessDescription: "Know the signs. Connect with a qualified care team.",
    learnMore: "Learn more", footerCopyright: "© Aarogya Drishti · Community oral health",
    footerLanguages: "English · తెలుగు · हिंदी",
    notifications: "Notifications", markRead: "Mark read",
    noNotifications: "No notifications to display.", closeNotifications: "Close notifications",
    patientSearch: "Search patients, mandals, villages...", mandalSearch: "Search mandals...",
    patientRecord: "Patient record", mandal: "Mandal", noSearchResults: "No matching patients or mandals.",
    workspace: "WORKSPACE", oralModules: "ORAL CANCER MODULES", yourAccount: "YOUR ACCOUNT",
    oralRecords: "Oral examination records", aiResults: "AI screening results",
    healthyMouth: "Healthy Mouth", healthyLife: "Healthy Life",
    callHelpline: "Call helpline 104", simulationOnly: "Simulation only · Not for clinical use",
    readStatus: "Read", unreadStatus: "Unread",
    dashboard: "Dashboard", doctorDashboard: "Doctor Dashboard", patientDashboard: "Patient Dashboard",
    mandalManagement: "Mandal Management", villageManagement: "Village Management", mandalNavigator: "Mandal Navigator",
    clinicalWorkspace: "Clinical workspace", assistantNav: "AI Assistant", oral: "Oral Health Screening",
    tobacco: "Tobacco Support", nutrition: "Nutrition Assistant", healthCard: "Family Health Card",
    navigator: "Mandal Navigator", appointments: "Doctor Appointment", reports: "Medical Records",
    settings: "Settings", quick: "Quick actions", register: "Register Patient", profile: "My profile", scan: "Health Card",
    check: "Start Screening", book: "Book Appointment", coverage: "Mandal Navigator",
    records: "Health Records", synced: "Offline Sync", view: "View details", signIn: "Sign in",
    signInPrompt: "Sign in to see your personal information and live dashboard statistics.",
    signInRequired: "Sign in to access this information.",
    mapDataUnavailable: "Mandal data is unavailable.", saved: "Saved offline",
    syncedState: "All changes synced", syncing: "Syncing…", retry: "Sync now",
    noPending: "No pending items to sync", pending: "Pending items",
    startAssistant: "Talk to Drishti", assistantPrompt: "Connect with your care team or ask for health guidance.",
    adminStats: "Live district overview", patientStats: "Your care summary",
    registerAction: "Register patient", recordsAction: "View records",
    noMandal: "No mandals available", loading: "Loading live data…", liveUpdated: "Live data updated",
    patients: "Eligible adults", screened: "Adults screened",
    coverageRate: "Screening coverage", images: "Images assessed",
    appointmentsCount: "Appointments", plans: "Active cessation plans",
    recordsCount: "Medical records", mandalsCount: "Mandals"
  }, [isTelugu]);
  const notificationText = (template: string) => {
    const key = `phase11.notificationMessages.${template}`;
    const translated = t(key);
    return translated === key ? template.replaceAll("_", " ") : translated;
  };

  const openAssistant = () => {
    if (!user) {
      navigate("/login");
      return;
    }
    window.dispatchEvent(new Event("aarogya-open-assistant"));
  };
  const loginFor = (role: string) => navigate(`/login?role=${role}`);
  const patientOrLogin = (path: string) => user ? navigate(path) : navigate("/patient/login");
  const screeningPath = careTeam ? "/doctor/cases" : user?.role === "patient" ? "/patient/screening" : "/patient/login";
  const patientRegistrationPath = careTeam ? "/patient/new" : user?.role === "patient" ? "/patient/profile" : user ? "/register" : "/patient/register";
  const navigatorPath = admin ? "/admin/navigator" : careTeam ? "/navigator" : "/login?role=district_admin";

  useEffect(() => {
    if (!user) return;
    let active = true;
    let inFlight = false;
    let initialLoad = true;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      if (initialLoad) setLoadingData(true);
      setError("");
      const tasks: Promise<void>[] = [];
      if (admin || careTeam) {
        tasks.push(getMandals().then((rows) => { if (active) setMandals(rows); }));
      }
      if (admin) {
        tasks.push(getDashboardSummary({ mandalId: selectedMandal || undefined }).then((value) => { if (active) setSummary(value); }));
      }
      if (user.role === "patient") {
        tasks.push((async () => {
          const profile = await getPatientProfile();
          const [records, appointmentsResponse, plansResponse] = await Promise.all([
            getPatientRecords(profile.id),
            api.get<{ appointments?: AppointmentRow[] }>("/appointments"),
            api.get<{ plans?: PlanRow[] }>(`/patients/${profile.id}/cessation-plans`)
          ]);
          if (active) setPersonal({
            records: records.length,
            appointments: appointmentsResponse.data.appointments?.length ?? 0,
            plans: plansResponse.data.plans?.filter((plan) => plan.status === "active").length ?? 0
          });
        })());
      } else if (careTeam) {
        tasks.push(api.get<{ appointments?: AppointmentRow[] }>("/appointments").then(({ data }) => {
          if (active) setPersonal({ records: 0, appointments: data.appointments?.length ?? 0, plans: 0 });
        }));
      }
      try {
        await Promise.all(tasks);
        if (active) setUpdatedAt(new Date());
      } catch (requestError: unknown) {
        if (active) setError(getApiMessage(requestError, "Unable to load current dashboard data."));
      } finally {
        initialLoad = false;
        inFlight = false;
        if (active) setLoadingData(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, refreshIntervalMs);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [admin, careTeam, selectedMandal, user]);

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      void totalPendingCount().then(setPending).catch(() => setPending(0));
    };
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("aarogya-sync-complete", refresh);
    window.addEventListener("aarogya-outbox-added", refresh);
    window.addEventListener("aarogya-sync-progress", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("aarogya-sync-complete", refresh);
      window.removeEventListener("aarogya-outbox-added", refresh);
      window.removeEventListener("aarogya-sync-progress", refresh);
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data } = await api.get<{ notifications: NotificationRow[] }>("/notifications");
        if (active) setNotifications(data.notifications);
      } catch (requestError: unknown) {
        if (active) setError(getApiMessage(requestError, "Unable to load recent activity."));
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, refreshIntervalMs);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user]);

  useEffect(() => {
    const query = searchText.trim();
    if (!careTeam || query.length < 2) {
      setSearchResults([]);
      setSearchError("");
      setSearchLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError("");
      void api.get<{ patients: SearchPatient[] }>("/patients", { params: { search: query } })
        .then(({ data }) => { if (active) setSearchResults(data.patients.slice(0, 5)); })
        .catch((requestError: unknown) => { if (active) setSearchError(getApiMessage(requestError, "Unable to search assigned patients.")); })
        .finally(() => { if (active) setSearchLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [careTeam, searchText]);

  const stats = useMemo(() => {
    if (!user) return [];
    if (admin && summary) return [
      { icon: "👥", label: labels.patients, value: summary.screeningCoverageDenominator, tone: "blue" },
      { icon: "🩺", label: labels.screened, value: summary.screenedAdults, tone: "orange" },
      { icon: "✓", label: labels.coverageRate, value: summary.screeningCoverage === null ? "—" : `${summary.screeningCoverage}%`, tone: "green" },
      { icon: "▣", label: labels.images, value: summary.imagesAssessed, tone: "pink" }
    ];
    if (user.role === "patient" && personal) return [
      { icon: "▤", label: labels.recordsCount, value: personal.records, tone: "blue" },
      { icon: "▦", label: labels.appointmentsCount, value: personal.appointments, tone: "orange" },
      { icon: "♡", label: labels.plans, value: personal.plans, tone: "green" },
      { icon: "↻", label: labels.pending, value: pending, tone: "pink" }
    ];
    if (careTeam && personal) return [
      { icon: "⌖", label: labels.mandalsCount, value: new Set(user.assignments?.map((item) => item.mandal).filter(Boolean)).size, tone: "blue" },
      { icon: "▦", label: labels.appointmentsCount, value: personal.appointments, tone: "orange" },
      { icon: "↻", label: labels.pending, value: pending, tone: "green" },
      { icon: "✓", label: labels.syncedState, value: online ? "Online" : "Offline", tone: "pink" }
    ];
    return [];
  }, [admin, careTeam, labels, online, pending, personal, summary, user]);

  const sync = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    setSyncing(true);
    setError("");
    try {
      await syncNow();
      setPending(await totalPendingCount());
    } catch (syncError) {
      setError(getApiMessage(syncError, syncError instanceof Error ? syncError.message : "Unable to sync offline data."));
    } finally {
      setSyncing(false);
    }
  };
  const toggleNotifications = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (notificationsOpen) {
      setNotificationsOpen(false);
      return;
    }
    setError("");
    try {
      const { data } = await api.get<{ notifications: NotificationRow[] }>("/notifications");
      setNotifications(data.notifications);
      setNotificationsOpen(true);
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to load notifications."));
    }
  };
  const markRead = async (item: NotificationRow) => {
    try {
      await api.patch(`/notifications/${item._id}/read`);
      setNotifications((current) => current.map((notification) => notification._id === item._id ? { ...notification, status: "read" } : notification));
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to update notification."));
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } catch (requestError) {
      setError(getApiMessage(requestError, "Your local session was cleared, but the server could not confirm sign-out."));
    } finally {
      navigate(user?.role === "patient" ? "/patient/login" : "/login", { replace: true });
    }
  };

  const signIn = () => loginFor("doctor");
  const openDoctorDashboard = () => navigate(user?.role === "doctor" ? "/doctor" : "/doctor/login");
  const openPatientDashboard = () => navigate(user?.role === "patient" ? "/patient-dashboard" : "/patient/login");
  const openRecords = () => {
    if (user?.role === "doctor") navigate("/doctor/workspace");
    else if (admin) navigate("/admin/dashboard");
    else patientOrLogin("/patient/profile");
  };
  const appointmentPath = admin ? "/admin/dashboard" : user ? "/appointments" : "/patient/login";
  const tobaccoPath = admin ? "/admin/dashboard" : user?.role === "patient" ? "/tobacco" : careTeam ? "/navigator" : "/patient/login";
  const settingsPath = admin ? "/admin/audit" : user ? "/sync" : "/login";
  const unreadCount = notifications.filter((notification) => notification.status !== "read").length;
  const matchingMandals = searchText.trim().length >= 2
    ? mandals.filter((mandal) => (mandal.name_en ?? mandal.name ?? "").toLowerCase().includes(searchText.trim().toLowerCase())).slice(0, 5)
    : [];
  const openPatientSearchResult = (patient: SearchPatient) => {
    setSearchText("");
    navigate(`/doctor/workspace?patientId=${encodeURIComponent(patient._id)}`);
  };
  const openProfile = () => {
    if (user?.role === "doctor") navigate("/doctor/profile");
    else if (user?.role === "patient") navigate("/patient/profile");
    else if (admin) navigate("/admin");
  };
  const doctorModules = [
    { title: isTelugu ? "రోగి నిర్వహణ" : "Patient Management", icon: "♙", href: "/doctor/workspace#patients" },
    { title: isTelugu ? "అపాయింట్‌మెంట్ నిర్వహణ" : "Appointment Management", icon: "▦", href: "/appointments#appointments" },
    { title: isTelugu ? "AI నోటి స్క్రీనింగ్ సమీక్ష" : "AI Oral Screening Review", icon: "◉", href: "/doctor/workspace#screening-review" },
    { title: isTelugu ? "ఆన్‌లైన్ సంప్రదింపు" : "Online Consultation", icon: "▣", href: "/appointments#appointments" },
    { title: isTelugu ? "ఇ-ప్రిస్క్రిప్షన్లు" : "Medicines & Prescriptions", icon: "✎", href: "/doctor/prescriptions" },
    { title: isTelugu ? "వైద్య రికార్డులు" : "Medical Records", icon: "▤", href: "/doctor/workspace#medical-records" },
    { title: isTelugu ? "రిఫరల్ నిర్వహణ" : "Referral Management", icon: "⇄", href: "/doctor/workspace#screening-review" },
    { title: isTelugu ? "రోగి ఫాలో-అప్" : "Patient Follow-up", icon: "↻", href: "/doctor/workspace#screening-review" },
    { title: isTelugu ? "ఆరోగ్య శిబిరాలు" : "Health Camp Management", icon: "✚", href: "/community#camp-list-heading" },
    { title: isTelugu ? "డయాగ్నస్టిక్ పరీక్షలు" : "Diagnostic Test Management", icon: "⌕", href: "/doctor/workspace#screening-review" },
    { title: isTelugu ? "నోటిఫికేషన్‌లు" : "Notifications", icon: "♧", onClick: () => void toggleNotifications() },
    { title: isTelugu ? "వైద్యుని ప్రొఫైల్" : "Doctor Profile", icon: "◉", href: "/doctor/profile" },
    { title: isTelugu ? "అందుబాటు నిర్వహణ" : "Availability Management", icon: "◷", href: "/doctor/availability" },
    { title: isTelugu ? "నివేదికలు & విశ్లేషణలు" : "Reports & Analytics", icon: "▥", href: "/analytics" }
  ];
  const numericStats = stats.map((stat) => ({
    stat,
    numericValue: typeof stat.value === "number" ? stat.value : Number.parseFloat(String(stat.value))
  }));
  const largestStat = Math.max(1, ...numericStats.map(({ numericValue }) => Number.isFinite(numericValue) ? numericValue : 0));

  return <div className="rd-app">
    <aside className="rd-sidebar">
      <nav className="rd-nav" aria-label="Main navigation">
        <p className="rd-nav-heading">{labels.workspace}</p>
        <button className="active" type="button" onClick={() => navigate(user?.role === "patient" ? "/patient-dashboard" : admin ? "/admin/dashboard" : careTeam ? "/doctor" : "/home")}><span>⌂</span>{labels.dashboard}</button>
        <button type="button" onClick={openDoctorDashboard}><span>🩺</span>{labels.doctorDashboard}</button>
        <button type="button" onClick={openPatientDashboard}><span>♙</span>{labels.patientDashboard}</button>
        {careTeam && <button type="button" onClick={() => navigate("/doctor/workspace")}><span>♧</span>{labels.clinicalWorkspace}</button>}
        {careTeam && <button type="button" onClick={() => navigate("/patient/new")}><span>♙</span>{labels.register}</button>}
        {admin && <button type="button" onClick={() => navigate("/admin/dashboard/villages")}><span>▤</span>{labels.villageManagement}</button>}
        {admin && <button type="button" onClick={() => navigate(navigatorPath)}><span>⌖</span>{labels.mandalManagement}</button>}
        {careTeam && <button type="button" onClick={() => navigate(navigatorPath)}><span>⌖</span>{labels.mandalNavigator}</button>}
        <p className="rd-nav-heading">{labels.oralModules}</p>
        <button type="button" onClick={() => navigate(screeningPath)}><span>◉</span>{labels.oral}</button>
        <button type="button" onClick={openRecords}><span>▣</span>{labels.oralRecords}</button>
        <button type="button" onClick={openRecords}><span>✧</span>{labels.aiResults}</button>
        <button type="button" onClick={() => navigate(appointmentPath)}><span>▦</span>{labels.appointments}</button>
        <button type="button" onClick={openRecords}><span>▤</span>{labels.reports}</button>
        {user?.role === "patient" && <button type="button" onClick={() => navigate(tobaccoPath)}><span>♡</span>{labels.tobacco}</button>}
        <p className="rd-nav-heading">{labels.yourAccount}</p>
        <button type="button" onClick={() => navigate(settingsPath)}><span>⚙</span>{labels.settings}</button>
        {!user && <button type="button" onClick={signIn}><span>⇥</span>{labels.signIn}</button>}
      </nav>
      <a className="rd-help" href="tel:104"><span aria-hidden="true">✚</span><div><b>{labels.healthyMouth}<br />{labels.healthyLife}</b><small>{labels.callHelpline}</small></div></a>
      <div className="rd-simulation">{labels.simulationOnly}</div>
    </aside>

    <main className="rd-main">
      <header className="rd-topbar">
        <div className="rd-search-wrap">
          {(admin || careTeam) ? <>
            <label className="rd-search"><span aria-hidden="true">⌕</span><input aria-label={careTeam ? labels.patientSearch : labels.mandalSearch} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={careTeam ? labels.patientSearch : labels.mandalSearch} /></label>
            {searchText.trim().length >= 2 && <div className="rd-search-results" role="status">
              {searchLoading && <p>Searching…</p>}
                {searchError && <p className="rd-search-error">{searchError}</p>}
                {!searchLoading && !searchError && searchResults.map((patient) => <button key={patient._id} type="button" onClick={() => openPatientSearchResult(patient)}><span className="rd-search-result-icon">♙</span><span><b>{patient.name}</b><small>{patient.patientCode ?? labels.patientRecord}</small></span></button>)}
                {!searchLoading && matchingMandals.map((mandal) => <button key={mandal._id} type="button" onClick={() => { setSelectedMandal(mandal._id); setSearchText(""); }}><span className="rd-search-result-icon">⌖</span><span><b>{mandal.name_en ?? mandal.name}</b><small>{labels.mandal}</small></span></button>)}
                {!searchLoading && !searchError && !searchResults.length && !matchingMandals.length && <p>{labels.noSearchResults}</p>}
            </div>}
          </> : <div className="rd-location"><span aria-hidden="true">⌖</span>{admin && mandals.length ? <select aria-label={labels.selectMandal} value={selectedMandal} onChange={(event) => setSelectedMandal(event.target.value)}><option value="">{labels.allMandals} · Andhra Pradesh</option>{mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{mandal.name_en ?? mandal.name}</option>)}</select> : <span>{user ? `Andhra Pradesh · ${labels.communityDashboard}` : labels.communityDashboard}</span>}</div>}
        </div>
        <div className="rd-top-actions">
          <button className="rd-icon-button" type="button" aria-label={`${labels.notifications}${unreadCount ? `, ${unreadCount}` : ""}`} aria-expanded={notificationsOpen} onClick={() => void toggleNotifications()}><span aria-hidden="true">♧</span>{unreadCount > 0 && <span className="rd-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}</button>
          <LanguageSwitcher />
          {user
            ? <button className="rd-user" type="button" onClick={openProfile}><span className="rd-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><b>{user.name}</b><small>{user.subRole ?? user.role.replace("_", " ")}</small></span><span className="rd-user-chevron" aria-hidden="true">⌄</span></button>
            : <button className="rd-signin" type="button" onClick={signIn}>{labels.signIn}</button>}
          {user && <button className="rd-signout" type="button" onClick={() => void signOut()}>Log out</button>}
        </div>
        {notificationsOpen && <section className="rd-notifications" aria-label={labels.notifications}>
          <div className="rd-notifications-heading"><b>{labels.notifications}</b><button type="button" onClick={() => setNotificationsOpen(false)} aria-label={labels.closeNotifications}>×</button></div>
          {notifications.map((item) => <article key={item._id}>
            <p>{notificationText(item.template)}</p><small>{new Date(item.createdAt).toLocaleString()} · {item.status === "read" ? labels.readStatus : labels.unreadStatus}</small>
            {item.status !== "read" && <button type="button" onClick={() => void markRead(item)}>{labels.markRead}</button>}
          </article>)}
          {notifications.length === 0 && <p className="rd-notifications-empty">{labels.noNotifications}</p>}
        </section>}
      </header>

      <div className="rd-dashboard">
        {(authLoading || loadingData) && <p className="rd-loading" role="status">{labels.loading}</p>}
        {user && updatedAt && <p className="text-right text-xs text-slate-500" aria-live="polite">{labels.liveUpdated}: {updatedAt.toLocaleTimeString()}</p>}
        {error && <p className="rd-error" role="alert">{error}</p>}
        <section className="rd-reference-hero">
          <div className="rd-reference-hero-copy">
            <span className="rd-eyebrow">{labels.platform}</span>
            <h1>AAROGYA DRISHTI</h1>
            <p className="rd-reference-tagline">{labels.heroTagline}</p>
            <p className="rd-reference-motto">{labels.heroMotto}</p>
          </div>
          <div className="rd-reference-art" aria-hidden="true">
            <span className="rd-reference-orbit rd-reference-orbit-one" />
            <span className="rd-reference-orbit rd-reference-orbit-two" />
            <span className="rd-reference-shield">✚</span>
            <span className="rd-reference-glow" />
          </div>
          <div className="rd-reference-callout"><strong>{labels.earlyScreening}<br />{labels.savesLives}</strong><span>⌁⌁⌁⌁⌁</span></div>
        </section>

        <section className="rd-reference-stats" aria-label={admin ? labels.adminStats : labels.patientStats}>
          {(stats.length ? stats : [
            { icon: "♙", label: labels.patients, value: "—", tone: "blue" },
            { icon: "▦", label: labels.appointmentsCount, value: "—", tone: "teal" },
            { icon: "◉", label: labels.recordsCount, value: "—", tone: "violet" },
            { icon: "✓", label: labels.coverageRate, value: "—", tone: "green" }
          ]).map((stat) => <article className={`rd-reference-stat rd-reference-${stat.tone}`} key={stat.label}>
            <span aria-hidden="true">{stat.icon}</span>
            <div><small>{stat.label}</small><strong>{stat.value}</strong>{!user && <small className="rd-stat-hint">{labels.signInLiveStats}</small>}</div>
          </article>)}
        </section>

        {careTeam && <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="doctor-modules-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div><h2 id="doctor-modules-heading" className="text-xl font-bold">{isTelugu ? "వైద్యుల సేవా విభాగాలు" : "Doctor Workspace"}</h2><p className="mt-1 text-sm text-slate-600">{isTelugu ? "మీ క్లినికల్ పనులు మరియు సేవలకు వెళ్లండి." : "Open your clinical tasks and operational tools."}</p></div>
            <span className="text-sm text-slate-500">{doctorModules.length} {isTelugu ? "విభాగాలు" : "modules"}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {doctorModules.map((module) => <button
              className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left font-semibold transition hover:border-medical-500 hover:bg-medical-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-700"
              key={module.title}
              type="button"
              onClick={module.onClick ?? (() => { if (module.href) navigate(module.href); })}
            ><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-medical-50 text-lg text-medical-800" aria-hidden="true">{module.icon}</span><span>{module.title}</span></button>)}
          </div>
        </section>}

        <section className="rd-reference-insights">
          <DashboardCard className="rd-reference-card rd-reference-overview" icon="▥" title={labels.overviewTitle}>
            {user && numericStats.length ? <div className="rd-metric-list">{numericStats.map(({ stat, numericValue }) => <div className="rd-metric" key={stat.label}>
              <div><span>{stat.label}</span><strong>{stat.value}</strong></div>
              <span className="rd-metric-track"><span className={`rd-metric-fill rd-fill-${stat.tone}`} style={{ width: `${Number.isFinite(numericValue) ? Math.max(numericValue > 0 ? 8 : 0, Math.min(100, numericValue / largestStat * 100)) : 0}%` }} /></span>
            </div>)}</div> : <div className="rd-empty-mini">{labels.signInRequired}</div>}
            <p className="rd-chart-note">{labels.currentFigures}</p>
          </DashboardCard>

          <DashboardCard className="rd-reference-card rd-reference-mandals" icon="⌖" title={labels.mandalStatsTitle} action={{ label: labels.view, onClick: () => navigate(navigatorPath) }}>
            <label className="rd-select-label">{labels.selectMandal}
              <select aria-label={labels.selectMandal} value={selectedMandal} onChange={(event) => setSelectedMandal(event.target.value)} disabled={!user || !mandals.length}>
                <option value="">{user ? labels.allMandals : labels.signInRequired}</option>
                {mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{mandal.name_en ?? mandal.name}</option>)}
              </select>
            </label>
            {user && mandals.length ? <ul className="rd-mandal-list">{mandals.slice(0, 6).map((mandal, index) => <li key={mandal._id}><span className={`rd-mandal-dot rd-dot-${index % 4}`} />{mandal.name_en ?? mandal.name}</li>)}</ul>
              : <div className="rd-empty-mini">{user ? labels.noMandal : labels.signInRequired}</div>}
            <p className="rd-coverage-note">{mandals.length ? `${mandals.length} ${labels.mandalsAvailable}` : labels.mapDataUnavailable}</p>
          </DashboardCard>

          <DashboardCard className="rd-reference-card rd-reference-activity" icon="◷" title={labels.recentActivityTitle} action={{ label: labels.viewAll, onClick: () => void toggleNotifications() }}>
            {user && notifications.length ? <div className="rd-activity-list">{notifications.slice(0, 4).map((item) => <article className={item.status === "read" ? "" : "rd-activity-unread"} key={item._id}>
              <span className="rd-activity-icon" aria-hidden="true">{item.template.includes("appointment") ? "▦" : item.template.includes("screening") ? "◉" : "♙"}</span>
              <div><b>{notificationText(item.template)}</b><small>{new Date(item.createdAt).toLocaleString()}</small></div>
              {item.status !== "read" && <button type="button" onClick={() => void markRead(item)} aria-label="Mark notification as read">✓</button>}
            </article>)}</div> : <div className="rd-empty-mini">{user ? labels.noRecentActivity : labels.signInRequired}</div>}
          </DashboardCard>
        </section>

        <section className="rd-reference-actions">
          <div className="rd-reference-quick">
            <h2>{labels.quickAccess}</h2>
            <div className="rd-quick-grid">
              <button className="rd-quick blue" type="button" onClick={() => navigate(patientRegistrationPath)}><span aria-hidden="true">♙</span>{user?.role === "patient" ? labels.profile : labels.register}</button>
              <button className="rd-quick violet" type="button" onClick={openRecords}><span aria-hidden="true">♧</span>{labels.scan}</button>
              <button className="rd-quick green" type="button" onClick={() => navigate(screeningPath)}><span aria-hidden="true">▦</span>{labels.check}</button>
              <button className="rd-quick orange" type="button" onClick={() => navigate(appointmentPath)}><span aria-hidden="true">▥</span>{labels.book}</button>
            </div>
          </div>
          <section className="rd-reference-awareness">
            <div><span className="rd-eyebrow">{labels.awareness}</span><h2>{labels.awarenessTitle}</h2><p>{labels.awarenessDescription}</p><button type="button" onClick={() => navigate("/education")}>{labels.learnMore} <span aria-hidden="true">→</span></button></div>
            <span className="rd-awareness-emblem" aria-hidden="true">✚</span>
          </section>
        </section>

        <div className="rd-overview">
          <section className="rd-hero">
            <div className="rd-hero-copy">
              <span className="rd-eyebrow">AAROGYA DRISHTI · COMMUNITY CARE</span>
              <h1>{labels.welcome}{user ? `, ${user.name.split(" ")[0]}` : "!"}</h1>
              <p>{labels.priority} <span aria-hidden="true">♥</span></p>
              <div className="rd-hero-quote">“Healthy Smile...<br />Healthy Life...”</div>
              <div className="rd-hero-visual" aria-hidden="true">
                <span className="rd-sun" /><span className="rd-mountain rd-mountain-back" /><span className="rd-mountain rd-mountain-front" /><span className="rd-medical-cross">✚</span>
                <div className="rd-doctor"><span className="rd-doctor-hair" /><span className="rd-doctor-face">◡</span><span className="rd-doctor-coat">✚</span></div>
              </div>
              <button className="rd-hero-cta" type="button" onClick={() => navigate(user ? (admin ? "/admin" : user.role === "patient" ? "/patient/profile" : "/doctor") : "/login")}>
                {user ? labels.view : labels.signIn}<span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="rd-stats" aria-label={admin ? labels.adminStats : labels.patientStats}>
              {stats.length ? stats.map((stat) => <article className={`rd-stat rd-${stat.tone}`} key={stat.label}>
                <span className="rd-stat-icon" aria-hidden="true">{stat.icon}</span><div><small>{stat.label}</small><strong>{stat.value}</strong></div>
              </article>) : [labels.patients, labels.appointmentsCount, labels.recordsCount, labels.coverageRate].map((label, index) => <article className={`rd-stat rd-stat-locked rd-${["blue", "orange", "green", "pink"][index]}`} key={label}>
                <span className="rd-stat-icon" aria-hidden="true">{["👥", "▦", "▤", "♥"][index]}</span><div><small>{label}</small><strong>{labels.signIn}</strong></div>
              </article>)}
            </div>
          </section>

          <section className="rd-assistant">
            <header><span className="rd-robot-icon" aria-hidden="true">◉</span><div><b>{labels.assistant}</b><small>Your health companion</small></div><span className="rd-live-dot" title={user ? "Assistant available" : "Sign-in required"} /></header>
            <div className="rd-assistant-art" aria-hidden="true"><div className="rd-robot"><span className="rd-robot-eye">••</span><span className="rd-robot-body">✚</span></div><span className="rd-sparkle">✦</span><span className="rd-sparkle second">✚</span></div>
            <p>{labels.assistantPrompt}</p>
            <button type="button" onClick={openAssistant}>{labels.startAssistant}<span aria-hidden="true">→</span></button>
          </section>
        </div>

        {user?.role === "patient" && <PatientCareSummary />}

        <section className="rd-quick-wrap">
          <div className="rd-quick-main"><h2>{labels.quick}</h2><div className="rd-quick-grid">
            <button className="rd-quick blue" type="button" onClick={() => navigate(patientRegistrationPath)}><span aria-hidden="true">{user?.role === "patient" ? "▤" : "♟+"}</span>{user?.role === "patient" ? labels.profile : labels.register}</button>
            <button className="rd-quick violet" type="button" onClick={() => openRecords()}><span aria-hidden="true">▦</span>{labels.scan}</button>
            <button className="rd-quick green" type="button" onClick={() => navigate(screeningPath)}><span aria-hidden="true">✚</span>{labels.check}</button>
            <button className="rd-quick orange" type="button" onClick={() => navigate(appointmentPath)}><span aria-hidden="true">▦</span>{labels.book}</button>
          </div></div>
          <section className="rd-coverage">
            <div className="rd-coverage-header"><h2>{labels.coverage}</h2><span>{mandals.length || "—"}</span></div>
            {user && mandals.length ? <>
              <div className="rd-map" aria-label={`${mandals.length} mandals available`} role="img"><div className="rd-map-shape">{mandals.slice(0, 11).map((mandal, index) => <span key={mandal._id} style={{ left: `${18 + ((index * 37) % 70)}%`, top: `${12 + ((index * 29) % 69)}%` }} title={mandal.name_en ?? mandal.name}>✦</span>)}</div></div>
              <p className="rd-coverage-note"><span aria-hidden="true">●</span>{mandals.length} mandals loaded from the health service</p>
            </> : <div className="rd-empty-mini">{user ? labels.mapDataUnavailable : labels.signInRequired}</div>}
            <button type="button" className="rd-map-link" onClick={() => navigate(navigatorPath)}>{labels.view}<span aria-hidden="true">→</span></button>
          </section>
        </section>

        <div className="rd-card-grid rd-card-grid-top">
          <DashboardCard className="rd-screen-card" icon="◉" title={labels.oral} action={{ label: labels.check, onClick: () => navigate(screeningPath) }}>
            <div className="rd-screen-visual" aria-hidden="true"><span>✚</span><b>Care begins with a check-in</b></div>
            <p>Start a screening visit with your care team. A clinician reviews results; this service does not provide a diagnosis.</p>
          </DashboardCard>
          <DashboardCard className="rd-map-card" icon="⌖" title={labels.navigator} action={{ label: labels.view, onClick: () => navigate(navigatorPath) }}>
            <label className="rd-select-label">Select mandal
              <select aria-label="Select mandal for navigator" value={selectedMandal} onChange={(event) => setSelectedMandal(event.target.value)} disabled={!user || !mandals.length}>
                <option value="">{user ? "All mandals" : labels.signInRequired}</option>
                {mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{mandal.name_en ?? mandal.name}</option>)}
              </select>
            </label>
            <ul className="rd-mandal-list">{(user ? mandals.slice(0, 5) : []).map((mandal) => <li key={mandal._id}><span>⌖</span>{mandal.name_en ?? mandal.name}</li>)}</ul>
            {!user && <p className="rd-card-muted">{labels.signInRequired}</p>}
            {user && !mandals.length && <p className="rd-card-muted">{labels.noMandal}</p>}
          </DashboardCard>
          <DashboardCard className="rd-nutrition-card" icon="♧" title={labels.nutrition} action={{ label: labels.view, onClick: () => navigate("/education/diet") }}>
            <div className="rd-food-art" aria-hidden="true"><img src="/education/images/produce.svg" alt="" /></div>
            <p>Explore practical, locally authored food guidance in your language.</p>
            <span className="rd-card-tip">Advice is general education—not a personal diet prescription.</span>
          </DashboardCard>
          <DashboardCard className="rd-health-card" icon="▦" title={labels.healthCard} action={{ label: labels.recordsAction, onClick: openRecords }}>
            <div className="rd-health-visual" aria-hidden="true"><span>▦</span><b>{user ? user.name : labels.signInRequired}</b></div>
            <p>Access your medical history and securely stored reports.</p>
          </DashboardCard>
        </div>

        <div className="rd-card-grid rd-card-grid-bottom">
          <DashboardCard className="rd-appointment-card" icon="♙" title={labels.appointments} action={{ label: labels.book, onClick: () => navigate(appointmentPath) }}>
            <div className="rd-doctor-badge" aria-hidden="true">✚</div>
            <div><b>{user ? labels.appointmentsCount : labels.signIn}</b><p>{user && personal ? personal.appointments : labels.signInRequired}</p></div>
          </DashboardCard>
          <DashboardCard className="rd-tobacco-card" icon="◎" title={labels.tobacco} action={{ label: labels.view, onClick: () => patientOrLogin(user?.role === "patient" ? "/tobacco" : "/patient/profile") }}>
            <div className="rd-tobacco-ring"><span>{user?.role === "patient" && personal ? personal.plans : "—"}</span></div>
            <div><b>{labels.plans}</b><p>Set and follow a cessation plan with your care team.</p></div>
          </DashboardCard>
          <DashboardCard className="rd-sync-card" icon="☁" title={labels.synced} action={{ label: syncing ? labels.syncing : labels.retry, onClick: () => void sync() }}>
            <div className="rd-sync-illustration" aria-hidden="true"><span>☁</span><b>⇅</b></div>
            <div className="rd-sync-info"><p><span>✓</span>{online ? "Connected to service" : pending ? "Offline changes are queued" : "Offline"}</p><p><span>✓</span>{pending ? `${pending} ${labels.pending.toLowerCase()}` : labels.noPending}</p><p><span>✓</span>{online ? labels.syncedState : "Waiting for connection"}</p></div>
          </DashboardCard>
        </div>
        <footer className="rd-footer"><span>{labels.footerCopyright}</span><span>{labels.footerLanguages}</span><span>{isTelugu ? "ఈ యాప్ అత్యవసర సేవలను పంపదు లేదా స్పందనకు హామీ ఇవ్వదు." : "This app does not dispatch emergency services or guarantee a response."}</span></footer>
      </div>
    </main>
  </div>;
}
