import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "./api";

const copyByLanguage = {
  en: { title: "Set your ASHA worker password", help: "Choose a unique password with at least 12 characters. This one-time link expires after 24 hours.", password: "New password", confirm: "Confirm password", invalid: "This setup link is invalid, expired, or unavailable. Ask your system administrator for a new link.", mismatch: "The passwords do not match.", submit: "Set password" },
  te: { title: "ఆశా కార్యకర్త పాస్‌వర్డ్ సెట్ చేయండి", help: "కనీసం 12 అక్షరాలతో ప్రత్యేకమైన పాస్‌వర్డ్ ఎంచుకోండి. ఈ ఒక్కసారి లింక్ 24 గంటల్లో గడువు ముగుస్తుంది.", password: "కొత్త పాస్‌వర్డ్", confirm: "పాస్‌వర్డ్‌ను నిర్ధారించండి", invalid: "ఈ సెటప్ లింక్ చెల్లదు లేదా గడువు ముగిసింది. కొత్త లింక్ కోసం సిస్టమ్ నిర్వాహకుడిని సంప్రదించండి.", mismatch: "పాస్‌వర్డ్‌లు సరిపోలడం లేదు.", submit: "పాస్‌వర్డ్ సెట్ చేయండి" },
  hi: { title: "आशा कार्यकर्ता पासवर्ड सेट करें", help: "कम से कम 12 वर्णों का अलग पासवर्ड चुनें। यह एक बार का लिंक 24 घंटे में समाप्त हो जाएगा।", password: "नया पासवर्ड", confirm: "पासवर्ड की पुष्टि करें", invalid: "यह सेटअप लिंक अमान्य या समाप्त हो गया है। नए लिंक के लिए सिस्टम प्रशासक से संपर्क करें।", mismatch: "पासवर्ड मेल नहीं खाते।", submit: "पासवर्ड सेट करें" }
} as const;

export default function AshaWorkerPasswordSetup() {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).split("-")[0] as keyof typeof copyByLanguage;
  const copy = copyByLanguage[language] ?? copyByLanguage.en;
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!token) { setError(copy.invalid); return; }
    if (password !== confirmation) { setError(copy.mismatch); return; }
    setBusy(true);
    try {
      await api.post("/auth/asha-worker/password-setup", { token, password });
      navigate("/login?role=asha_worker", { replace: true, state: { passwordSetupComplete: true } });
    } catch (requestError) { setError(getApiMessage(requestError, copy.invalid)); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-medical-50">
    <SimulationBanner />
    <main className="mx-auto max-w-lg px-4 pb-10 pt-24">
      <header className="mb-8 flex items-center justify-between"><div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{copy.title}</h1></div><LanguageSwitcher /></header>
      <form className="space-y-4 rounded-2xl bg-white p-6 shadow-sm" onSubmit={(event) => void submit(event)}>
        <p className="text-slate-700">{copy.help}</p>
        <label className="block font-semibold">{copy.password}<input className="mt-1 w-full rounded-lg border p-3" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="block font-semibold">{copy.confirm}<input className="mt-1 w-full rounded-lg border p-3" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {!token && <p className="rounded-lg bg-amber-50 p-3 text-amber-900" role="alert">{copy.invalid}</p>}
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
        <button className="min-h-touch w-full rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="submit" disabled={busy || !token}>{busy ? t("loading") : copy.submit}</button>
      </form>
    </main>
  </div>;
}
