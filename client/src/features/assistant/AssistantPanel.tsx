import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { AssistantContext } from "./assistantContext";
import { currentLanguage } from "../education/educationApi";
import type { AssistantStatus, ChatMessage } from "./useRealtimeAssistant";
import { AssistantRobot } from "./AssistantRobot";

const ui = {
  en: { title: "AAROHINI · Ask Drishti", start: "Start voice", stop: "End voice", mute: "Mute", unmute: "Unmute", send: "Send", placeholder: "Ask an education question", close: "Close assistant", listening: "Listening", speaking: "Speaking", connecting: "Connecting", idle: "Ready", error: "Voice unavailable", sources: "Reviewed sources", education: "Education mode", registration: "Registration helper", status: "NOT medical advice - educational assistant", retry: "Reconnect voice" },
  te: { title: "ఆరోహిణి · దృష్టిని అడగండి", start: "వాయిస్ ప్రారంభించండి", stop: "వాయిస్ ముగించండి", mute: "మ్యూట్", unmute: "అన్‌మ్యూట్", send: "పంపండి", placeholder: "విద్యా ప్రశ్న అడగండి", close: "సహాయకుడిని మూసివేయండి", listening: "వింటోంది", speaking: "మాట్లాడుతోంది", connecting: "కనెక్ట్ అవుతోంది", idle: "సిద్ధంగా ఉంది", error: "వాయిస్ అందుబాటులో లేదు", sources: "సమీక్షించిన మూలాలు", education: "విద్యా విధానం", registration: "నమోదు సహాయకుడు", status: "వైద్య సలహా కాదు - విద్యా సహాయకుడు", retry: "వాయిస్‌ను మళ్లీ కనెక్ట్ చేయండి" },
  hi: { title: "AAROHINI · दृष्टि से पूछें", start: "आवाज़ शुरू करें", stop: "आवाज़ बंद करें", mute: "म्यूट", unmute: "अनम्यूट", send: "भेजें", placeholder: "शैक्षिक सवाल पूछें", close: "सहायक बंद करें", listening: "सुन रहा है", speaking: "बोल रहा है", connecting: "कनेक्ट हो रहा है", idle: "तैयार", error: "आवाज़ उपलब्ध नहीं", sources: "समीक्षित स्रोत", education: "शिक्षा मोड", registration: "पंजीकरण सहायक", status: "चिकित्सकीय सलाह नहीं - शैक्षिक सहायक", retry: "आवाज़ फिर जोड़ें" }
} as const;

function statusLabel(status: AssistantStatus, language: keyof typeof ui) {
  if (status === "listening") return ui[language].listening;
  if (status === "speaking") return ui[language].speaking;
  if (status === "connecting") return ui[language].connecting;
  if (status === "error") return ui[language].error;
  return ui[language].idle;
}

export default function AssistantPanel({ open, onClose, context, status, messages, muted, error, audioLevel, remoteAudio, startVoice, endVoice, sendText, toggleMute }: {
  open: boolean;
  onClose: () => void;
  context: AssistantContext;
  status: AssistantStatus;
  messages: ChatMessage[];
  muted: boolean;
  error: string;
  audioLevel: number;
  remoteAudio: React.RefObject<HTMLAudioElement>;
  startVoice: () => Promise<void>;
  endVoice: () => void;
  sendText: (text: string) => Promise<void>;
  toggleMute: () => void;
}) {
  const { i18n } = useTranslation();
  const language = currentLanguage(i18n.resolvedLanguage ?? i18n.language);
  const words = ui[language];
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose, open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = text.trim();
    if (!question) return;
    setText("");
    await sendText(question);
  }

  return <>
  <section className={`fixed inset-x-2 bottom-20 z-[70] ${open ? "flex" : "hidden"} max-h-[78vh] flex-col overflow-hidden rounded-2xl border border-medical-800 bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[min(28rem,calc(100vw-2rem))]`} aria-hidden={!open} role="dialog" aria-modal="false" aria-labelledby="assistant-heading">
    <header className="flex items-center justify-between gap-2 bg-medical-900 px-4 py-3 text-white">
      <div><h2 className="text-xl font-bold" id="assistant-heading">{words.title}</h2><p className="text-sm">{context.mode === "registration" ? words.registration : words.education}{context.field ? ` · ${context.field.replaceAll("_", " ")}` : ""}</p></div>
      <button className="min-h-touch min-w-touch rounded-lg border border-white/60 px-3 font-bold" type="button" onClick={onClose} aria-label={words.close}>×</button>
    </header>
    <div className="flex items-center gap-2 border-b bg-teal-50 px-4 py-2">
      <AssistantRobot level={audioLevel} status={status} />
      <div className="min-w-0">
        <p className="font-bold" role="status">{statusLabel(status, language)}</p>
        <p className="text-sm text-slate-700">{words.status}</p>
        <p className="mt-1 text-xs text-slate-600">Language: {language === "te" ? "తెలుగు" : language === "hi" ? "हिंदी" : "English"}</p>
      </div>
    </div>
    <div className="min-h-24 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-relevant="additions text">
      {messages.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{context.mode === "registration"
        ? language === "te" ? "ప్రస్తుత నమోదు దశ లేదా ఫారమ్ ఫీల్డ్ గురించి అడగండి. వ్యక్తిగత వివరాలను టైప్ చేయవద్దు." : language === "hi" ? "पंजीकरण चरण या फ़ॉर्म फ़ील्ड के बारे में पूछें। व्यक्तिगत जानकारी न लिखें।" : "Ask about the current registration step or form field. Do not enter personal details."
        : language === "te" ? "విద్యా సమాచారం గురించి అడగండి." : language === "hi" ? "शैक्षिक जानकारी के बारे में पूछें।" : "Ask a question about the education topics."}</p>}
      {messages.map((message, index) => <article key={`${index}-${message.role}`} className={message.role === "user" ? "ml-8 rounded-xl bg-medical-100 p-3" : "mr-6 rounded-xl bg-slate-100 p-3"}>
        <p className="text-xs font-bold uppercase">{message.role === "user" ? "You" : "Drishti"}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        {!!message.sources?.length && <p className="mt-2 text-xs text-slate-700">{words.sources}: {message.sources.join(", ")}</p>}
      </article>)}
      <div ref={end} />
    </div>
    <div className="border-t p-3">
      {error && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-sm" role="alert">{error}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        {status === "idle" || status === "error"
          ? <button className="min-h-touch rounded-xl bg-medical-700 px-4 font-bold text-white" type="button" onClick={() => void startVoice()}>{status === "error" ? words.retry : words.start}</button>
          : <><button className="min-h-touch rounded-xl border border-medical-700 px-4 font-bold" type="button" onClick={toggleMute}>{muted ? words.unmute : words.mute}</button><button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={endVoice}>{words.stop}</button></>}
      </div>
      <form className="flex gap-2" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="assistant-text">{words.placeholder}</label>
        <input id="assistant-text" className="min-h-touch min-w-0 flex-1 rounded-xl border px-3" value={text} onChange={(event) => setText(event.target.value)} placeholder={words.placeholder} maxLength={2000} />
        <button className="min-h-touch rounded-xl bg-medical-800 px-4 font-bold text-white" type="submit" disabled={!text.trim()}>{words.send}</button>
      </form>
    </div>
  </section>
  <audio ref={remoteAudio} className="hidden" aria-hidden="true" />
  </>;
}
