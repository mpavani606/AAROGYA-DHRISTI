import { useEffect } from "react";

export type AssistantMode = "education" | "registration";
export type RegistrationField = "abha" | "aarogyasri" | "family" | "name" | "phone" | "address" | "date_of_birth" | "consent" | "summary" | "general";
export type AssistantContext = { mode: AssistantMode; field?: RegistrationField; topic?: string };

const EVENT_NAME = "aarogya-assistant-context";

export function publishAssistantContext(context: AssistantContext) {
  window.dispatchEvent(new CustomEvent<AssistantContext>(EVENT_NAME, { detail: context }));
}

export function useAssistantContext(context: AssistantContext) {
  const { mode, field, topic } = context;
  useEffect(() => {
    publishAssistantContext({ mode, field, topic });
    return () => publishAssistantContext({ mode: "education" });
  }, [mode, field, topic]);
}

export function assistantContextEventName() {
  return EVENT_NAME;
}
