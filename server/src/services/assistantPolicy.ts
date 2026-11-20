import type { RetrievedPassage } from "../rag/search.js";

export const ASSISTANT_BASE_PROMPT = "You are an AI Oral Cancer Educational Assistant. Your responsibilities: 1. Explain oral cancer in simple language. 2. Communicate with patients naturally. 3. Support Telugu, English and Hindi. 4. Answer questions about symptoms, prevention, diagnosis and treatment. 5. Explain nutrition information. 6. Use verified medical knowledge. 7. Give short and understandable answers. 8. Allow patients to ask follow-up questions. 9. Maintain conversation context. 10. Never diagnose cancer or prescribe medicines. 11. Recommend consulting qualified doctors for medical concerns. 12. If information is unavailable, clearly say that you do not know. Your communication style: Friendly, calm, respectful and patient.";

export const ASSISTANT_GUARDRAILS = `Always call search_medical_knowledge before answering medical questions and answer only from returned passages; reply in the language the user speaks; never state or imply that a person has or does not have cancer; never give medicine names or dosages; for emergencies say to visit the nearest facility or call 108; for out-of-scope questions say "Please ask your doctor or ASHA."; keep answers under 4 short sentences unless asked for more. This is educational information only and not medical advice. Do not request or repeat personal identifiers.`;

const diagnosisPatterns = [
  /\bdo\s+i\s+have\b/i,
  /\bcan\s+you\s+diagnos/i,
  /\bis\s+this\s+(?:cancer|malignan)/i,
  /\bwhat\s+stage\b/i,
  /\bdoes\s+this\s+mean\s+i\s+have\b/i
];
const emergencyPattern = /\b(?:emergency|can't breathe|cannot breathe|severe bleeding|unconscious|choking)\b|सांस\s+नहीं|गंभीर रक्तस्राव|बेहोश|ఉపిరి ఆడటం లేదు|తీవ్ర రక్తస్రావం|అపస్మారక/iu;
const outOfScopePattern = /\b(?:weather|football|cricket score|write (?:code|a poem)|stock price|recipe for)\b/i;

const safeResponses = {
  en: {
    diagnosis: "I cannot assess an individual's health. This needs a doctor's examination. Please ask your doctor or ASHA.",
    emergency: "Please visit the nearest health facility or call 108 now.",
    unknown: "I do not know from the reviewed information available. Please ask your doctor or ASHA.",
    outOfScope: "Please ask your doctor or ASHA."
  },
  te: {
    diagnosis: "నేను వ్యక్తిగత ఆరోగ్యాన్ని అంచనా వేయలేను. దీనికి వైద్యుడి పరీక్ష అవసరం. దయచేసి మీ వైద్యుడిని లేదా ఆశా కార్యకర్తను అడగండి.",
    emergency: "దయచేసి వెంటనే సమీప ఆరోగ్య కేంద్రానికి వెళ్లండి లేదా 108కు కాల్ చేయండి.",
    unknown: "సమీక్షించిన సమాచారంలో నాకు సమాధానం తెలియదు. దయచేసి మీ వైద్యుడిని లేదా ఆశా కార్యకర్తను అడగండి.",
    outOfScope: "దయచేసి మీ వైద్యుడిని లేదా ఆశా కార్యకర్తను అడగండి."
  },
  hi: {
    diagnosis: "मैं किसी व्यक्ति के स्वास्थ्य का आकलन नहीं कर सकता। इसके लिए डॉक्टर की जांच जरूरी है। कृपया अपने डॉक्टर या आशा कार्यकर्ता से पूछें।",
    emergency: "कृपया तुरंत नजदीकी स्वास्थ्य केंद्र जाएं या 108 पर कॉल करें।",
    unknown: "समीक्षित जानकारी में मुझे इसका उत्तर नहीं पता। कृपया अपने डॉक्टर या आशा कार्यकर्ता से पूछें।",
    outOfScope: "कृपया अपने डॉक्टर या आशा कार्यकर्ता से पूछें।"
  }
} as const;

export function safeFallback(query: string, language: "en" | "te" | "hi", passages: RetrievedPassage[]) {
  const responses = safeResponses[language];
  if (emergencyPattern.test(query)) return responses.emergency;
  if (diagnosisPatterns.some((pattern) => pattern.test(query))) return responses.diagnosis;
  if (outOfScopePattern.test(query)) return responses.outOfScope;
  if (passages.length === 0) return responses.unknown;
  return null;
}

export function buildAssistantInstructions(mode: "education" | "registration", field?: string) {
  const context = mode === "registration"
    ? ` The user is using registration helper mode. Explain form fields and the Aarogyasri card flow only; never ask them to dictate personal identifiers to the assistant. Current registration step: ${field ?? "general"}.`
    : " The user is using education mode.";
  return `${ASSISTANT_BASE_PROMPT}\n\n${ASSISTANT_GUARDRAILS}${context}`;
}

export function redactIdentifiers(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[redacted]")
    .replace(/\b\d{12}\b/g, "[redacted]")
    .replace(/\b(?:AD|PT)-[A-Z0-9-]+\b/gi, "[redacted]")
    .replace(/\b(?:ABHA|Aarogyasri)(?:\s*(?:ID|number|no\.?))?\s*[:#-]?\s*[A-Z0-9-]{6,}\b/gi, "[redacted]")
    .replace(/\bmy\s+(?:name|address|phone|mobile|id)\s+is\s+[^,.!?]+/gi, "[redacted]")
    .replace(/\b(?:i am|i'm|i live at|my village is)\s+[^,.!?]+/gi, "[redacted]")
    .replace(/\b(?:patient|person)\s+(?:name|id)\s*[:#-]?\s*[^,.!?]+/gi, "[redacted]")
    .slice(0, 2000);
}

export function guardAssistantResponse(response: string, language: "en" | "te" | "hi") {
  const prohibited = [
    /\byou\s+(?:have|do\s+not\s+have)\s+(?:oral\s+)?cancer\b/i,
    /\byou\s+are\s+(?:cancer[\s-]*free|healthy)\b/i,
    /\b(?:this|it|that)\s+(?:is|looks like)\s+(?:oral\s+)?cancer\b/i,
    /\bno\s+(?:oral\s+)?cancer\b/i,
    /\b(?:your|this|it|that|the\s+lesion|the\s+image|the\s+photo)\b.{0,80}\b(?:cancer|malignant|tumou?r)\b/i,
    /\b(?:cancer|malignant|tumou?r)\b.{0,80}\b(?:you|your)\b/i,
    /మీకు\s+క్యాన్సర్\s+(?:ఉంది|లేదు|ఉండవచ్చు)/u,
    /आपको\s+कैंसर\s+(?:है|नहीं\s+है|हो\s+सकता\s+है)/u,
    /\byour\s+(?:lesion|image|photo|mouth)\s+(?:is|looks)\s+(?:normal|safe)\b/i,
    /\b(?:take|use)\s+[a-z][a-z-]+\s+\d+\s*(?:mg|ml|mcg|tablet|dose)\b/i,
    /\b\d+\s*(?:mg|ml|mcg)\b/i
  ];
  if (prohibited.some((pattern) => pattern.test(response))) return safeResponses[language].diagnosis;
  return response.trim();
}

export function passagesForPrompt(passages: RetrievedPassage[]) {
  return passages.map((passage, index) => `[${index + 1}; source ${passage.sourceSlug}]\n${passage.text}`).join("\n\n");
}
