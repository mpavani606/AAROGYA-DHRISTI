import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { currentLanguage, loadPage, type EducationPage } from "./educationApi";
import { EducationFooter } from "./EducationFooter";
import { SpeakerButton } from "./SpeakerButton";
import { splitSentences } from "./educationText";
import { useAssistantContext } from "../assistant/assistantContext";

const labels = { en: { back: "All education", error: "This education page is not available." }, te: { back: "అన్ని విద్యా పేజీలు", error: "ఈ విద్యా పేజీ అందుబాటులో లేదు." }, hi: { back: "सभी शिक्षा पृष्ठ", error: "यह शिक्षा पृष्ठ उपलब्ध नहीं है।" } } as const;

export default function EducationPageView() {
  const { slug = "" } = useParams();
  const { i18n } = useTranslation();
  const language = currentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const [page, setPage] = useState<EducationPage | null>(null);
  const [error, setError] = useState("");
  const [highlighted, setHighlighted] = useState(-1);
  useAssistantContext({ mode: "education", topic: slug });
  useEffect(() => {
    let active = true;
    setPage(null); setError(""); setHighlighted(-1);
    void loadPage(slug, language).then((value) => { if (active) setPage(value); }).catch(() => { if (active) setError(labels[language].error); });
    return () => { active = false; };
  }, [slug, language]);
  const sentences = splitSentences(page?.body ?? "");
  return <><SimulationBanner /><main className="mx-auto max-w-3xl px-4 pb-12 pt-24">
    <header className="flex flex-wrap items-center justify-between gap-4"><Link className="min-h-touch inline-flex items-center font-bold text-medical-800" to="/education">← {labels[language].back}</Link><LanguageSwitcher /></header>
    {!page && !error && <p className="mt-6 rounded-xl bg-white p-5" role="status">Loading…</p>}
    {error && <p className="mt-6 rounded-xl bg-white p-5" role="alert">{error}</p>}
    {page && <article className="mt-6">
      <h1 className="mb-5 text-3xl font-bold">{page.title}</h1>
      <SpeakerButton slug={page.slug} text={page.body} language={language} audioRef={page.audioRef} onSentence={setHighlighted} />
      <div className="mt-6 space-y-4 rounded-2xl bg-white p-6 text-lg leading-8 shadow-sm">
        {sentences.map((sentence, index) => <p key={`${index}-${sentence}`} className={index === highlighted ? "rounded-lg bg-amber-100 px-2 py-1" : ""} aria-current={index === highlighted ? "true" : undefined}>{sentence}</p>)}
      </div>
      <EducationFooter page={page} language={language} />
    </article>}
  </main></>;
}
