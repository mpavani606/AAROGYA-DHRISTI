import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthProvider";
import { currentLanguage } from "../education/educationApi";
import AssistantPanel from "./AssistantPanel";
import { assistantContextEventName, type AssistantContext } from "./assistantContext";
import { useRealtimeAssistant } from "./useRealtimeAssistant";

export default function AssistantFab() {
  const { user } = useAuth();
  const location = useLocation();
  const { i18n } = useTranslation();
  const language = currentLanguage(i18n.resolvedLanguage ?? i18n.language ?? user?.language ?? "en");
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<AssistantContext>({ mode: "education" });
  const assistant = useRealtimeAssistant(language, context);
  const { endVoice, clearConversation, ...assistantPanelProps } = assistant;
  const close = useCallback(() => { endVoice(); setOpen(false); }, [endVoice]);
  const userId = user?.id;
  const previousUserId = useRef(userId);
  useEffect(() => {
    if (previousUserId.current !== userId || !userId) {
      endVoice();
      clearConversation();
      setOpen(false);
      setContext({ mode: "education" });
    }
    previousUserId.current = userId;
  }, [clearConversation, endVoice, userId]);
  useEffect(() => {
    const onContext = (event: Event) => {
      const detail = (event as CustomEvent<AssistantContext>).detail;
      if (detail?.mode === "education" || detail?.mode === "registration") setContext(detail);
    };
    window.addEventListener(assistantContextEventName(), onContext);
    return () => window.removeEventListener(assistantContextEventName(), onContext);
  }, []);
  useEffect(() => {
    const openAssistant = () => setOpen(true);
    window.addEventListener("aarogya-open-assistant", openAssistant);
    return () => window.removeEventListener("aarogya-open-assistant", openAssistant);
  }, []);
  if (!user) return null;
  const button = language === "te" ? "దృష్టిని అడగండి" : language === "hi" ? "दृष्टि से पूछें" : "Ask Drishti";
  return <>
    {location.pathname !== "/" && <button className="fixed bottom-4 right-4 z-[69] min-h-14 min-w-14 rounded-full bg-medical-800 px-5 font-bold text-white shadow-xl focus:outline-none focus:ring-4 focus:ring-medical-300" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={button}>
      <span aria-hidden="true">✦</span><span className="ml-2">{button}</span>
    </button>}
    <AssistantPanel open={open} onClose={close} endVoice={endVoice} context={context} {...assistantPanelProps} />
  </>;
}
