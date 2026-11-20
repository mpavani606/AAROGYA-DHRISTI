import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { currentLanguage } from "./educationApi";
import { EducationFooter } from "./EducationFooter";

const text = {
  en: { title: "Image credits", lead: "All food category illustrations are original decorative artwork created for this simulation.", license: "License: CC0, self-created by the Aarogya Drishti project team. Illustrations are symbolic category artwork, not photographs of the listed foods.", back: "Education" },
  te: { title: "చిత్రాల కృతజ్ఞతలు", lead: "అన్ని ఆహార వర్గ చిత్రాలు ఈ సిమ్యులేషన్ కోసం ప్రత్యేకంగా రూపొందించిన అలంకార చిత్రాలు.", license: "లైసెన్స్: CC0; ఆరోగ్య దృష్టి ప్రాజెక్ట్ బృందం స్వయంగా రూపొందించింది. ఇవి వర్గాన్ని సూచించే చిత్రాలు మాత్రమే, ఆహార ఫోటోలు కావు.", back: "విద్య" },
  hi: { title: "चित्र श्रेय", lead: "सभी खाद्य श्रेणी चित्र इस सिमुलेशन के लिए बनाई गई मौलिक सजावटी कला हैं।", license: "लाइसेंस: CC0; आरोग्य दृष्टि परियोजना टीम द्वारा स्वयं निर्मित। ये श्रेणी दर्शाने वाले चित्र हैं, सूचीबद्ध भोजन के फोटो नहीं।", back: "शिक्षा" }
} as const;

export default function EducationCredits() {
  const { i18n } = useTranslation();
  const language = currentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const words = text[language];
  return <><SimulationBanner /><main className="mx-auto max-w-3xl px-4 pb-12 pt-24">
    <header className="flex flex-wrap items-center justify-between gap-4"><Link className="min-h-touch inline-flex items-center font-bold text-medical-800" to="/education">← {words.back}</Link><LanguageSwitcher /></header>
    <article className="mt-6 rounded-2xl bg-white p-6 shadow-sm"><h1 className="text-3xl font-bold">{words.title}</h1><p className="mt-4 text-lg">{words.lead}</p><p className="mt-3 leading-7">{words.license}</p><p className="mt-3 text-slate-700">Source: client/public/education/images · Author: Aarogya Drishti project team</p></article>
    <EducationFooter language={language} />
  </main></>;
}
