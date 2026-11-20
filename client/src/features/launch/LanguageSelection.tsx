import { useState } from "react";
import { useTranslation } from "react-i18next";

const languages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
  { code: "hi", name: "Hindi", nativeName: "हिंदी" }
] as const;

type LanguageSelectionProps = {
  onComplete: () => void;
};

export default function LanguageSelection({ onComplete }: LanguageSelectionProps) {
  const { i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function selectLanguage(language: typeof languages[number]["code"]) {
    setBusy(true);
    setError("");
    try {
      await i18n.changeLanguage(language);
      localStorage.setItem("aarogya-language", language);
      onComplete();
    } catch {
      setError("Unable to apply your language selection. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#e0f7f5,_#eff6ff_58%,_#f8fafc)] px-4 py-10 text-slate-900">
    <section className="w-full max-w-xl rounded-3xl border border-teal-100 bg-white p-6 shadow-xl sm:p-10" aria-labelledby="language-selection-title">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-teal-800 text-3xl font-bold text-white shadow-lg" aria-hidden="true">✚</div>
      <p className="text-center text-xs font-bold uppercase tracking-[0.18em] text-teal-800">AAROGYA DRISHTI</p>
      <h1 id="language-selection-title" className="mt-3 text-center text-2xl font-bold sm:text-3xl">Select your language</h1>
      <p className="mt-2 text-center text-slate-600">మీ భాషను ఎంచుకోండి · अपनी भाषा चुनें</p>
      <p className="mt-6 text-center text-sm text-slate-600">Choose a language to continue to the application.</p>
      {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {languages.map((language) => <button
          key={language.code}
          type="button"
          disabled={busy}
          onClick={() => void selectLanguage(language.code)}
          className="min-h-16 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center font-semibold text-teal-950 transition hover:border-teal-700 hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-700 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="block text-lg">{language.nativeName}</span>
          <span className="mt-1 block text-xs text-slate-600">{language.name}</span>
        </button>)}
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">You can change your language later in Settings.</p>
    </section>
  </main>;
}
