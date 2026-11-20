import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../auth/api";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { currentLanguage, getCatalog, type Catalog, type Language } from "./educationApi";
import { EducationFooter } from "./EducationFooter";

type Food = { key: string; name: string; category: string; imageUrl: string; suitabilityNote: string; license: string; source: string; author: string };
const groups: Record<Language, Record<string, string>> = {
  en: { leafy_greens: "Leafy greens", vegetables_fruits: "Vegetables and fruits", grains: "Grains", protein: "Dal, pulses and protein foods", fluids: "Drinks and soups", careful: "Foods to be careful with" },
  te: { leafy_greens: "ఆకుకూరలు", vegetables_fruits: "కూరగాయలు మరియు పండ్లు", grains: "ధాన్యాలు", protein: "పప్పులు మరియు ప్రోటీన్ ఆహారం", fluids: "పానీయాలు మరియు సూప్‌లు", careful: "జాగ్రత్తగా తీసుకోవాల్సిన ఆహారం" },
  hi: { leafy_greens: "पत्तेदार सब्जियां", vegetables_fruits: "सब्जियां और फल", grains: "अनाज", protein: "दाल, फलियां और प्रोटीन वाले भोजन", fluids: "पेय और सूप", careful: "जिन खाद्य पदार्थों से सावधानी रखें" }
};
const tipLabels = {
  en: "Choose foods that are available to you. If eating or swallowing is difficult, ask your doctor or diet professional for advice.",
  te: "మీకు అందుబాటులో ఉన్న ఆహారాన్ని ఎంచుకోండి. తినడం లేదా మింగడం కష్టమైతే వైద్యుడు లేదా ఆహార నిపుణుడిని అడగండి.",
  hi: "उपलब्ध भोजन चुनें। खाने या निगलने में कठिनाई हो तो डॉक्टर या आहार विशेषज्ञ से सलाह लें।"
} as const;
const categoryImage: Record<string, string> = {
  leafy_greens: "/education/images/leafy-greens.svg", vegetables_fruits: "/education/images/produce.svg",
  grains: "/education/images/grains.svg", protein: "/education/images/protein.svg",
  fluids: "/education/images/fluids.svg", careful: "/education/images/careful.svg"
};

async function loadFoods(language: Language): Promise<Food[]> {
  try {
    const { data } = await api.get<{ items: Food[] }>("/education/foods", { params: { language } });
    return data.items;
  } catch {
    const catalog: Catalog = await getCatalog();
    return catalog.foods.map((food) => ({
      key: food.id, name: food.name[language], category: food.category, imageUrl: categoryImage[food.category],
      suitabilityNote: catalog.softFoodTip[language], license: "CC0; self-created decorative illustration",
      source: "Locally authored category illustration", author: "Aarogya Drishti project team"
    }));
  }
}

export default function DietGuide() {
  const { i18n } = useTranslation();
  const language = currentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const [foods, setFoods] = useState<Food[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadFoods(language).then((value) => { if (active) setFoods(value); }).catch(() => { if (active) setError("Food guide is unavailable. Reconnect and try again."); });
    return () => { active = false; };
  }, [language]);
  const order = ["leafy_greens", "vegetables_fruits", "grains", "protein", "fluids", "careful"];
  return <><SimulationBanner /><main className="mx-auto max-w-6xl px-4 pb-12 pt-24">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><Link to="/education" className="min-h-touch inline-flex items-center font-bold text-medical-800">← {language === "te" ? "విద్య" : language === "hi" ? "शिक्षा" : "Education"}</Link><h1 className="mt-2 text-3xl font-bold">{language === "te" ? "ఆహార మార్గదర్శి" : language === "hi" ? "आहार मार्गदर्शिका" : "Food guide"}</h1></div><LanguageSwitcher /></header>
    <p className="mt-5 rounded-2xl bg-medical-50 p-5 text-lg">{tipLabels[language]}</p>
    {error && <p className="mt-4 rounded-xl bg-amber-50 p-4" role="alert">{error}</p>}
    <div className="mt-6 space-y-8">{order.map((category) => {
      const items = foods.filter((food) => food.category === category);
      if (!items.length) return null;
      return <section key={category} aria-labelledby={`food-group-${category}`}>
        <h2 id={`food-group-${category}`} className="mb-4 text-2xl font-bold">{groups[language][category]}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((food) => <article key={food.key} className="overflow-hidden rounded-2xl border border-medical-200 bg-white shadow-sm">
            <img className="h-40 w-full object-cover" src={food.imageUrl} alt={food.name} width="640" height="360" loading="lazy" />
            <div className="p-5"><h3 className="text-xl font-bold">{food.name}</h3><p className="mt-2 leading-6 text-slate-700">{food.suitabilityNote}</p></div>
          </article>)}
        </div>
      </section>;
    })}</div>
    <EducationFooter language={language} />
  </main></>;
}
