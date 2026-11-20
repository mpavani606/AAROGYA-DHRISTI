import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";
import { currentLanguage, loadPages, type EducationPage } from "./educationApi";
import { EducationFooter } from "./EducationFooter";

const pageIcons = ["◉", "☷", "♧", "⌂", "♡", "◌", "↗", "?"];
const labels = { en: { title: "Learn and prepare", subtitle: "General information in your language", diet: "Food guide", credits: "Image credits", manage: "Content review" }, te: { title: "తెలుసుకోండి, సిద్ధం కండి", subtitle: "మీ భాషలో సాధారణ సమాచారం", diet: "ఆహార మార్గదర్శి", credits: "చిత్రాల కృతజ్ఞతలు", manage: "విషయ సమీక్ష" }, hi: { title: "जानें और तैयारी करें", subtitle: "अपनी भाषा में सामान्य जानकारी", diet: "आहार मार्गदर्शिका", credits: "चित्र श्रेय", manage: "सामग्री समीक्षा" } } as const;

export default function EducationHome() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const language = currentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const [pages, setPages] = useState<EducationPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadPages(language).then((value) => { if (active) setPages(value); }).catch(() => { if (active) setError("Education content is unavailable. Reconnect and try again."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [language]);
  const words = labels[language];
  return <><SimulationBanner /><main className="mx-auto max-w-5xl px-4 pb-12 pt-24">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-bold text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{words.title}</h1><p className="mt-2 text-slate-700">{words.subtitle}</p></div><LanguageSwitcher /></header>
    <nav className="mt-6 flex flex-wrap gap-3" aria-label="Education links">
      <Link to="/education/diet" className="min-h-touch rounded-xl bg-medical-700 px-5 py-3 font-bold text-white">{words.diet}</Link>
      <Link to="/education/credits" className="min-h-touch rounded-xl border border-medical-700 px-5 py-3 font-bold">{words.credits}</Link>
      {user?.role === "doctor" && <Link to="/education/manage" className="min-h-touch rounded-xl border border-medical-700 px-5 py-3 font-bold">{words.manage}</Link>}
    </nav>
    {loading && <p className="mt-6 rounded-xl bg-white p-5" role="status">Loading…</p>}
    {error && <p className="mt-6 rounded-xl bg-amber-50 p-5" role="alert">{error}</p>}
    <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label={words.title}>
      {pages.map((page, index) => <Link key={page.slug} to={`/education/${page.slug}`} className="flex min-h-28 items-center gap-4 rounded-2xl border border-medical-200 bg-white p-5 shadow-sm hover:border-medical-700 focus:outline-none focus:ring-4 focus:ring-medical-300">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-medical-100 text-3xl text-medical-900" aria-hidden="true">{pageIcons[index % pageIcons.length]}</span>
        <span><span className="block text-lg font-bold">{page.title}</span><span className="mt-1 block text-sm text-slate-600">{page.status === "published" ? "Reviewed education" : "Pending clinical review"}</span></span>
      </Link>)}
      {!loading && pages.length === 0 && <p className="rounded-xl bg-white p-5">Education pages will appear here when available.</p>}
    </section>
    <EducationFooter language={language} />
  </main></>;
}
