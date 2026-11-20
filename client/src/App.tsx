import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "./components/BrandLogo";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { SimulationBanner } from "./components/SimulationBanner";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import Login from "./features/auth/Login";
import HospitalManagerPasswordSetup from "./features/auth/HospitalManagerPasswordSetup";
import PatientOtpLogin from "./features/auth/PatientOtpLogin";
import PatientRegistration from "./features/auth/PatientRegistration";
import Register from "./features/auth/Register";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import AdminArea from "./features/admin/AdminArea";
import HospitalManagerDashboard from "./features/admin/HospitalManagerDashboard";
import MandalNavigator from "./features/admin/MandalNavigator";
import MandalDetail from "./features/admin/MandalDetail";
import AuditLogViewer from "./features/admin/AuditLogViewer";
import DistrictDashboard from "./features/admin/DistrictDashboard";
import { AshaActivity, DashboardDataQuality, VillageCoverage } from "./features/admin/DashboardPages";
import NewPatient from "./features/patient/NewPatient";
import PatientProfile from "./features/patient/PatientProfile";
import CaseFlow from "./features/caseflow/CaseFlow";
import DoctorPortal from "./features/doctor/DoctorPortal";
import DoctorDashboard from "./features/doctor/DoctorDashboard";
import DoctorRegistration from "./features/doctor/DoctorRegistration";
import DoctorProfile from "./features/doctor/DoctorProfile";
import DoctorAvailability from "./features/doctor/DoctorAvailability";
import AppointmentPortal from "./features/appointments/AppointmentPortal";
import NavigatorBoard from "./features/navigator/NavigatorBoard";
import LocationConsent from "./features/location/LocationConsent";
import SyncCentre from "./features/sync/SyncCentre";
import { SyncStatusChip } from "./components/SyncStatusChip";
import { PinLock } from "./components/PinLock";
import { InstallPrompt } from "./components/InstallPrompt";
import { startAutomaticSync } from "./offline/sync";
import EducationHome from "./features/education/EducationHome";
import EducationPageView from "./features/education/EducationPageView";
import DietGuide from "./features/education/DietGuide";
import EducationCredits from "./features/education/EducationCredits";
import EducationManager from "./features/education/EducationManager";
import AssistantFab from "./features/assistant/AssistantFab";
import TobaccoTracker from "./features/patient/TobaccoTracker";
import PatientScreening from "./features/patient/PatientScreening";
import PatientDashboard from "./features/patient/PatientDashboard";
import Welcome from "./features/auth/Welcome";
import OperationalAnalytics from "./features/analytics/OperationalAnalytics";
import CommunityPortal from "./features/community/CommunityPortal";
import AshaDashboard from "./features/asha/AshaDashboard";
import AshaWorkerPasswordSetup from "./features/auth/AshaWorkerPasswordSetup";
import LaunchScreen, { SESSION_KEY as LAUNCH_SESSION_KEY } from "./features/launch/LaunchScreen";
import LanguageSelection from "./features/launch/LanguageSelection";
import ReferenceDashboard from "./features/dashboards/ReferenceDashboard";
import PrescriptionDashboard, { PrescriptionDetailsPage } from "./features/doctor/PrescriptionDashboard";

function LanguageGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [languageSelected, setLanguageSelected] = useState(() => sessionStorage.getItem("aarogya-language-selected") === "true");

  if (!languageSelected && sessionStorage.getItem("aarogya-language-selected") !== "true" && location.pathname !== "/") return <LanguageSelection onComplete={() => {
    sessionStorage.setItem("aarogya-language-selected", "true");
    setLanguageSelected(true);
  }} />;
  return children;
}

function WelcomeEntry() {
  const [launchComplete, setLaunchComplete] = useState(() => sessionStorage.getItem(LAUNCH_SESSION_KEY) === "true");
  const [languageSelected, setLanguageSelected] = useState(() => sessionStorage.getItem("aarogya-language-selected") === "true");
  if (!launchComplete) return <LaunchScreen onComplete={() => setLaunchComplete(true)} />;
  if (!languageSelected) return <LanguageSelection onComplete={() => {
    sessionStorage.setItem("aarogya-language-selected", "true");
    setLanguageSelected(true);
  }} />;
  return <Welcome />;
}

const oralHomeCopy = {
  en: {
    navHow: "How it works", navLearn: "Learn", signIn: "Sign in", getStarted: "Get started",
    screening: "Open screening workflow", appointments: "View appointments",
    eyebrow: "ORAL CANCER SCREENING", title: "Oral health screening, with care at every step.",
    intro: "Learn about oral health, register for a screening visit, and find your next step with a care team.",
    explore: "Explore oral health guides", trust: "A community screening is a first step—not a diagnosis.",
    caption: "Care starts with a conversation", captionNote: "Small steps. Support at every stage.",
    journey: "YOUR CARE JOURNEY", journeyTitle: "Three steps, with people beside you.",
    journeyIntro: "Understand what to expect before you begin. Your care team can help at each step.",
    learn: "Learn", learnText: "Explore clear, practical oral health information in your language.",
    learnLink: "Browse learning guides", screen: "Get screened",
    screenText: "Register for a community screening and share information with consent.",
    follow: "Follow up", followText: "If a closer look is needed, a clinician can explain appropriate next steps.",
    connect: "Connect with your care team", disclaimer: "Screening supports care—it does not diagnose.",
    disclaimerText: "Only a qualified clinician can assess findings and recommend follow-up. If you have a concern about your mouth or oral health, speak with a healthcare professional.",
    more: "Learn more", footer: "© Aarogya Drishti · Community oral health", simulation: "Simulation only · Not for clinical use"
  },
  te: {
    navHow: "ఇది ఎలా పనిచేస్తుంది", navLearn: "నేర్చుకోండి", signIn: "సైన్ ఇన్", getStarted: "ప్రారంభించండి",
    screening: "స్క్రీనింగ్ ప్రక్రియను తెరవండి", appointments: "అపాయింట్‌మెంట్‌లు చూడండి",
    eyebrow: "నోటి క్యాన్సర్ స్క్రీనింగ్", title: "ప్రతి దశలో తోడుగా ఉండే నోటి ఆరోగ్య స్క్రీనింగ్.",
    intro: "నోటి ఆరోగ్యం గురించి తెలుసుకోండి, స్క్రీనింగ్ సందర్శనకు నమోదు చేసుకోండి, తదుపరి అడుగులో సంరక్షణ బృందం సహాయం పొందండి.",
    explore: "నోటి ఆరోగ్య మార్గదర్శకాలు", trust: "సమాజ స్క్రీనింగ్ మొదటి అడుగు మాత్రమే—ఇది నిర్ధారణ కాదు.",
    caption: "సంభాషణతో సంరక్షణ ప్రారంభం", captionNote: "చిన్న అడుగులు. ప్రతి దశలో తోడ్పాటు.",
    journey: "మీ సంరక్షణ ప్రయాణం", journeyTitle: "మీతో పాటు ఉండే వారితో మూడు అడుగులు.",
    journeyIntro: "ప్రారంభించే ముందు ఏమి ఆశించాలో తెలుసుకోండి. ప్రతి దశలో మీ సంరక్షణ బృందం సహాయపడుతుంది.",
    learn: "తెలుసుకోండి", learnText: "మీ భాషలో సరళమైన, ఉపయోగకరమైన నోటి ఆరోగ్య సమాచారాన్ని తెలుసుకోండి.",
    learnLink: "విద్యా మార్గదర్శకాలు చూడండి", screen: "స్క్రీనింగ్ పొందండి",
    screenText: "సమాజ స్క్రీనింగ్‌కు నమోదు చేసుకుని, సమ్మతితో సమాచారాన్ని పంచుకోండి.",
    follow: "తదుపరి సంరక్షణ", followText: "మరింత పరిశీలన అవసరమైతే, వైద్యుడు తదుపరి చర్యలను వివరిస్తారు.",
    connect: "సంరక్షణ బృందాన్ని సంప్రదించండి", disclaimer: "స్క్రీనింగ్ సంరక్షణకు తోడ్పడుతుంది—నిర్ధారణ చేయదు.",
    disclaimerText: "పరిశీలనలను అంచనా వేసి తదుపరి సంరక్షణను సూచించేది అర్హత కలిగిన వైద్యుడు మాత్రమే. నోటి ఆరోగ్యం గురించి ఆందోళన ఉంటే ఆరోగ్య నిపుణుడిని సంప్రదించండి.",
    more: "మరింత తెలుసుకోండి", footer: "© ఆరోగ్య దృష్టి · సమాజ నోటి ఆరోగ్యం", simulation: "అనుకరణ మాత్రమే · వైద్య వినియోగానికి కాదు"
  },
  hi: {
    navHow: "यह कैसे काम करता है", navLearn: "जानें", signIn: "साइन इन", getStarted: "शुरू करें",
    screening: "स्क्रीनिंग प्रक्रिया खोलें", appointments: "अपॉइंटमेंट देखें",
    eyebrow: "मुंह के कैंसर की स्क्रीनिंग", title: "हर कदम पर देखभाल के साथ मौखिक स्वास्थ्य जांच।",
    intro: "मौखिक स्वास्थ्य के बारे में जानें, स्क्रीनिंग विज़िट के लिए पंजीकरण करें और देखभाल टीम के साथ अगला कदम समझें।",
    explore: "मौखिक स्वास्थ्य मार्गदर्शिकाएं", trust: "सामुदायिक स्क्रीनिंग पहला कदम है—निदान नहीं।",
    caption: "देखभाल बातचीत से शुरू होती है", captionNote: "छोटे कदम। हर चरण में सहायता।",
    journey: "आपकी देखभाल यात्रा", journeyTitle: "आपके साथ लोगों के तीन कदम।",
    journeyIntro: "शुरू करने से पहले जानें कि क्या अपेक्षा करें। आपकी देखभाल टीम हर कदम पर मदद कर सकती है।",
    learn: "जानें", learnText: "अपनी भाषा में स्पष्ट और उपयोगी मौखिक स्वास्थ्य जानकारी पढ़ें।",
    learnLink: "शैक्षिक मार्गदर्शिकाएं देखें", screen: "स्क्रीनिंग कराएं",
    screenText: "सामुदायिक स्क्रीनिंग के लिए पंजीकरण करें और सहमति से जानकारी साझा करें।",
    follow: "आगे की देखभाल", followText: "यदि आगे जांच की जरूरत हो, तो चिकित्सक उचित अगले कदम समझाएंगे।",
    connect: "अपनी देखभाल टीम से जुड़ें", disclaimer: "स्क्रीनिंग देखभाल में मदद करती है—निदान नहीं करती।",
    disclaimerText: "निष्कर्षों का आकलन और आगे की देखभाल की सलाह केवल योग्य चिकित्सक दे सकते हैं। मुंह या मौखिक स्वास्थ्य को लेकर चिंता हो तो स्वास्थ्य पेशेवर से बात करें।",
    more: "और जानें", footer: "© आरोग्य दृष्टि · सामुदायिक मौखिक स्वास्थ्य", simulation: "केवल सिमुलेशन · नैदानिक उपयोग के लिए नहीं"
  }
} as const;

function GlobalSyncStatus() {
  const location = useLocation();
  return location.pathname === "/" ? null : <SyncStatusChip />;
}

function HashScroll() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const timer = window.setTimeout(() => {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.hash, location.pathname]);
  return null;
}

function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();
  const selectedLanguage = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
  const text = oralHomeCopy[selectedLanguage === "te" || selectedLanguage === "hi" ? selectedLanguage : "en"];
  const isCareTeam = user?.role === "doctor";
  const isAdmin = user?.role === "district_admin" || user?.role === "system_admin";
  const primaryHref = isCareTeam ? "/doctor/cases" : user?.role === "patient" ? "/appointments" : "/patient/register";
  const primaryLabel = isCareTeam ? text.screening : user?.role === "patient" ? text.appointments : text.getStarted;
  const registrationHref = isCareTeam ? "/patient/new" : user?.role === "patient" ? "/patient-dashboard" : isAdmin ? "/admin" : "/patient/register";
  const registrationLabel = user?.role === "patient" ? "Patient dashboard" : "Patient registration";
  const screeningHref = isAdmin ? "/admin/dashboard/quality" : isCareTeam ? "/doctor/cases" : user ? "/appointments" : "/login";
  const appointmentsHref = user && !isAdmin ? "/appointments" : isAdmin ? "/admin/dashboard" : "/login";
  const navigatorHref = isCareTeam ? "/navigator" : isAdmin ? "/admin/navigator" : user ? "/appointments" : "/login";
  const reportsHref = user?.role === "patient" ? "/patient/profile" : user?.role === "doctor" ? "/doctor" : isAdmin ? "/admin/dashboard" : user ? "/navigator" : "/login";
  const dashboardHref = isAdmin ? "/admin/dashboard" : user?.role === "doctor" ? "/doctor" : user?.role === "patient" ? "/patient-dashboard" : "/login";
  const navigation = [
    { label: "Dashboard", icon: "⌂", href: user?.role === "patient" ? "/patient-dashboard" : "#dashboard", current: true },
    { label: registrationLabel, icon: "♙", href: registrationHref },
    { label: "Oral screening", icon: "◉", href: screeningHref },
    { label: "AI-assisted review", icon: "✧", href: screeningHref },
    { label: "Telemedicine", icon: "▣", href: appointmentsHref },
    { label: "Referral management", icon: "⇄", href: navigatorHref },
    { label: "Medical reports", icon: "▤", href: reportsHref },
    { label: "Analytics", icon: "▥", href: dashboardHref },
    ...(user?.role === "patient" ? [{ label: t("phase10.navPatient"), icon: "!", href: "/community" }] : []),
    ...(user && user.role !== "patient" ? [{ label: t("phase10.navStaff"), icon: "⌂", href: "/community" }] : [])
  ];
  const services = [
    { title: registrationLabel, description: user?.role === "patient" ? "Open your patient dashboard and care information." : "Register a patient or continue to patient sign in.", icon: "♙", tone: "blue", label: user?.role === "patient" ? "Open dashboard" : "Register patient", href: registrationHref },
    { title: "Oral screening", description: "Start a screening visit with your care team.", icon: "◉", tone: "mint", label: "Open screening", href: screeningHref },
    { title: "AI-assisted review", description: "Continue to a clinician-supported assessment.", icon: "✧", tone: "lilac", label: "Continue", href: screeningHref },
    { title: "Telemedicine", description: "View appointments and connect with care.", icon: "▣", tone: "peach", label: "View appointments", href: appointmentsHref },
    { title: "Medical reports", description: "Open your records or clinical workspace.", icon: "▤", tone: "aqua", label: "View reports", href: reportsHref },
    { title: "Oral health guides", description: "Explore practical guidance in your language.", icon: "♡", tone: "rose", label: "Explore guides", href: "/education" },
    ...(user ? [{ title: user.role === "patient" ? t("phase10.emergency") : t("phase10.title"), description: user.role === "patient" ? t("phase10.emergencyWarning") : t("phase10.description"), icon: "⌂", tone: "aqua", label: user.role === "patient" ? t("phase10.navPatient") : t("phase10.navStaff"), href: "/community" }] : [])
  ];

  return (
    <>
      <SimulationBanner />
      <div className="ad-dashboard" id="dashboard">
        <aside className="ad-sidebar">
          <Link className="ad-brand" to="/home" aria-label="Aarogya Drishti dashboard">
            <span className="ad-brand-mark" aria-hidden="true">✚</span>
            <span><strong>AAROGYA<br />DRISHTI</strong><small>Healthy mouth. Healthy life.</small></span>
          </Link>
          <nav className="ad-side-nav" aria-label="Dashboard navigation">
            {navigation.map((item) => (
              <Link className={`ad-side-link${item.current ? " ad-side-link-active" : ""}`} key={item.label} to={item.href} aria-current={item.current ? "page" : undefined}>
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </Link>
            ))}
            <Link className="ad-side-link" to={user ? "/education" : "/login"}><span aria-hidden="true">⚙</span>{text.navLearn}</Link>
            {user && <button className="ad-side-link ad-logout" type="button" onClick={async () => { try { await logout(); } finally { navigate(user.role === "patient" ? "/patient/login" : "/login"); } }}><span aria-hidden="true">⇥</span>Log out</button>}
          </nav>
          <div className="ad-sidebar-note"><span aria-hidden="true">♡</span><strong>Early detection saves lives</strong><small>Take the next step in your care journey.</small></div>
        </aside>

        <div className="ad-workspace">
          <header className="ad-topbar">
            <div className="ad-ministry"><span className="ad-emblem" aria-hidden="true">✥</span><span><strong>Ministry of Health &amp; Family Welfare</strong><small>Government of India</small></span></div>
            <p className="ad-topbar-message">Together for a cancer-free India</p>
            <div className="ad-topbar-actions">
              <LanguageSwitcher />
              {user
                ? <div className="ad-user"><span className="ad-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.subRole ?? user.role.replace("_", " ")}</small></span></div>
                : <>
                  <Link className="ad-sign-in" to="/patient/login">{t("phase6.patientLogin")}</Link>
                  <Link className="ad-sign-in" to="/doctor/login">{t("phase6.doctorLogin")}</Link>
                </>}
            </div>
          </header>

          <main className="ad-main">
            <section className="ad-hero">
              <div className="ad-hero-copy">
                <span className="ad-eyebrow"><span aria-hidden="true" />{text.eyebrow}</span>
                <h1>Aarogya Drishti</h1>
                <p className="ad-hero-tagline">{text.title}</p>
                <p>{text.intro}</p>
                <div className="ad-hero-actions">
                  <Link className="ad-primary-button" to={primaryHref}>{primaryLabel}<span aria-hidden="true">→</span></Link>
                  <Link className="ad-secondary-button" to="/education">{text.explore}</Link>
                </div>
                <div className="ad-hero-assurance"><span aria-hidden="true">✓</span>{text.trust}</div>
              </div>
              <div className="ad-care-panel">
                <div className="ad-care-panel-heading"><span className="ad-care-icon" aria-hidden="true">✦</span><span><strong>Your care journey</strong><small>A simple place to begin</small></span></div>
                <div className="ad-journey-step"><span>01</span><div><strong>Learn</strong><small>Understand oral health in your language.</small></div></div>
                <div className="ad-journey-step"><span>02</span><div><strong>Get screened</strong><small>Connect with a community care team.</small></div></div>
                <div className="ad-journey-step"><span>03</span><div><strong>Follow up</strong><small>A clinician can guide your next step.</small></div></div>
                <Link to={primaryHref} className="ad-care-link">{primaryLabel}<span aria-hidden="true">→</span></Link>
              </div>
              <span className="ad-hero-decoration ad-decoration-one" aria-hidden="true">✳</span>
              <span className="ad-hero-decoration ad-decoration-two" aria-hidden="true">+</span>
            </section>

            <section className="ad-service-section" id="quick-links">
              <div className="ad-section-heading"><div><span className="ad-section-kicker">CARE, ALL IN ONE PLACE</span><h2>What would you like to do?</h2></div><p>Choose a service to continue</p></div>
              <div className="ad-service-grid">
                {services.map((service) => (
                  <article className={`ad-service-card ad-tone-${service.tone}`} key={service.title}>
                    <span className="ad-service-icon" aria-hidden="true">{service.icon}</span>
                    <h3>{service.title}</h3>
                    <p>{service.description}</p>
                    <Link to={service.href}>{service.label}<span aria-hidden="true">→</span></Link>
                  </article>
                ))}
              </div>
            </section>

            <section className="ad-disclaimer"><span aria-hidden="true">i</span><p><strong>{text.disclaimer}</strong> {text.disclaimerText}</p><Link to="/education">{text.more}<span aria-hidden="true">→</span></Link></section>
          </main>
          <footer className="ad-footer"><span>© Aarogya Drishti · Community oral health</span><span>English · తెలుగు · हिंदी</span><span>Screening supports care—it does not diagnose.</span></footer>
        </div>
      </div>
    </>
  );
}

export default function App() {
  useEffect(() => startAutomaticSync(), []);
  return (
    <AuthProvider>
      <BrowserRouter>
        <HashScroll />
        <BrandLogo />
        <LanguageGate>
        <Routes>
          <Route path="/" element={<WelcomeEntry />} />
          <Route path="/home" element={<ReferenceDashboard />} />
          <Route path="/welcome" element={<Home />} />
          <Route path="/start" element={<WelcomeEntry />} />
          <Route path="/login" element={<Login />} />
          <Route path="/doctor/login" element={<Login />} />
          <Route path="/hospital-manager/setup" element={<HospitalManagerPasswordSetup />} />
          <Route path="/asha/setup" element={<AshaWorkerPasswordSetup />} />
          <Route path="/patient/login" element={<PatientOtpLogin />} />
          <Route path="/patient/register" element={<PatientRegistration />} />
          <Route path="/register" element={<Register />} />
          <Route path="/doctor/register" element={<DoctorRegistration />} />
          <Route path="/education" element={<EducationHome />} />
          <Route path="/education/diet" element={<DietGuide />} />
          <Route path="/education/credits" element={<EducationCredits />} />
          <Route element={<ProtectedRoute roles={["doctor"]} />}><Route path="/education/manage" element={<EducationManager />} /></Route>
          <Route path="/education/:slug" element={<EducationPageView />} />
          <Route element={<ProtectedRoute roles={["patient"]} />}>
            <Route path="/patient-dashboard" element={<PatientDashboard />} />
            <Route path="/patient" element={<Navigate to="/patient-dashboard" replace />} />
            <Route path="/patient/screening" element={<PatientScreening />} />
            <Route path="/patient/cases" element={<CaseFlow />} />
          </Route>
          <Route element={<ProtectedRoute roles={["patient"]} />}><Route path="/patient/profile" element={<PatientProfile />} /></Route>
          <Route element={<ProtectedRoute roles={["patient"]} />}><Route path="/tobacco" element={<TobaccoTracker />} /></Route>
          <Route element={<ProtectedRoute roles={["patient", "doctor"]} />}><Route path="/appointments" element={<AppointmentPortal />} /></Route>
          <Route path="/location/share" element={<LocationConsent />} />
          <Route element={<ProtectedRoute roles={["patient", "doctor"]} />}><Route path="/sync" element={<SyncCentre />} /></Route>
          <Route element={<ProtectedRoute roles={["patient", "doctor", "district_admin", "hospital_manager", "system_admin", "asha_worker"]} />}><Route path="/community" element={<CommunityPortal />} /></Route>
          <Route element={<ProtectedRoute roles={["doctor"]} />}><Route path="/navigator" element={<NavigatorBoard />} /></Route>
          <Route element={<ProtectedRoute roles={["doctor"]} />}><Route path="/doctor/cases" element={<CaseFlow />} /></Route>
          <Route element={<ProtectedRoute roles={["doctor"]} />}><Route path="/patient/new" element={<NewPatient />} /></Route>
          <Route element={<ProtectedRoute roles={["doctor"]} />}>
            <Route path="/doctor" element={<DoctorDashboard />} />
            <Route path="/doctor/workspace" element={<DoctorPortal />} />
            <Route path="/doctor/prescriptions" element={<PrescriptionDashboard />} />
            <Route path="/doctor/prescriptions/:prescriptionId" element={<PrescriptionDetailsPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["doctor"]} />}><Route path="/doctor/profile" element={<DoctorProfile />} /></Route>
          <Route element={<ProtectedRoute roles={["doctor"]} />}><Route path="/doctor/availability" element={<DoctorAvailability />} /></Route>
          <Route element={<ProtectedRoute roles={["hospital_manager"]} />}><Route path="/hospital-manager" element={<HospitalManagerDashboard />} /></Route>
          <Route element={<ProtectedRoute roles={["asha_worker"]} />}><Route path="/asha" element={<AshaDashboard />} /></Route>
          <Route element={<ProtectedRoute roles={["doctor", "hospital_manager", "district_admin", "system_admin"]} />}><Route path="/analytics" element={<OperationalAnalytics />} /></Route>
          <Route element={<ProtectedRoute roles={["district_admin", "system_admin"]} />}>
            <Route path="/admin" element={<AdminArea />} />
            <Route path="/admin/dashboard" element={<DistrictDashboard />} />
            <Route path="/admin/dashboard/quality" element={<DashboardDataQuality />} />
            <Route path="/admin/dashboard/villages" element={<VillageCoverage />} />
            <Route path="/admin/dashboard/asha" element={<AshaActivity />} />
            <Route path="/admin/dashboard/asha/:id" element={<AshaActivity />} />
            <Route path="/admin/navigator" element={<MandalNavigator />} />
            <Route path="/admin/navigator/:id" element={<MandalDetail />} />
            <Route path="/admin/audit" element={<AuditLogViewer />} />
          </Route>
        </Routes>
        <GlobalSyncStatus />
        <PinLock />
        <InstallPrompt />
        <AssistantFab />
        </LanguageGate>
      </BrowserRouter>
    </AuthProvider>
  );
}
