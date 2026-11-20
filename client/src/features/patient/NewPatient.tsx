import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { getApiMessage } from "../auth/api";
import { isConnected } from "../../offline/sync";
import { checkPatientDuplicate, createPatientRegistration, uploadAarogyasri, type PatientDraft } from "./patientApi";
import { queuePatientRegistration } from "./offline";
import { useAssistantContext, type RegistrationField } from "../assistant/assistantContext";

const steps = ["ABHA", "Aarogyasri", "Family", "Details", "Check", "Consent", "Summary"];
const labels = {
  en: { title: "New patient registration", next: "Continue", back: "Back", save: "Save registration", warning: "Demo data only: this workflow does not diagnose, prescribe, or replace a clinician.", abha: "How will you provide ABHA?", have: "I have ABHA", none: "I do not have ABHA", card: "Aarogyasri card (optional)", family: "Family members", add: "Add family member", details: "Patient details", ask: "Ask Drishti", hint: "Describe what you want to enter. Drishti prepares a draft for your confirmation.", prepare: "Prepare draft", confirm: "Confirm and fill", check: "Duplicate check", consent: "Consent", read: "Read aloud", sign: "Draw signature or thumb mark", agree: "I consent to registration", summary: "Registration summary", name: "Full name", phone: "Phone number", address: "Address", dob: "Date of birth", offline: "Saved offline. This provisional token will be reconciled when connected.", noDuplicate: "No likely duplicate found in demo check." },
  te: { title: "కొత్త రోగి నమోదు", next: "కొనసాగించండి", back: "వెనుకకు", save: "నమోదు సేవ్ చేయండి", warning: "డెమో డేటా మాత్రమే: ఇది నిర్ధారణ లేదా చికిత్స కాదు.", abha: "ABHA ఎలా అందిస్తారు?", have: "నా వద్ద ABHA ఉంది", none: "నా వద్ద ABHA లేదు", card: "ఆరోగ్యశ్రీ కార్డు (ఐచ్ఛికం)", family: "కుటుంబ సభ్యులు", add: "సభ్యుడిని చేర్చండి", details: "రోగి వివరాలు", ask: "దృష్టిని అడగండి", hint: "మీరు నమోదు చేయాలనుకున్నది చెప్పండి. మీ నిర్ధారణ తర్వాత మాత్రమే డ్రాఫ్ట్ నింపుతుంది.", prepare: "డ్రాఫ్ట్ సిద్ధం చేయండి", confirm: "నిర్ధారించి నింపండి", check: "డూప్లికేట్ తనిఖీ", consent: "సమ్మతి", read: "చదివి వినిపించండి", sign: "సంతకం లేదా బొటనవేలు గుర్తు గీయండి", agree: "నమోదుకు నా సమ్మతి ఉంది", summary: "నమోదు సారాంశం", name: "పూర్తి పేరు", phone: "ఫోన్ నంబర్", address: "చిరునామా", dob: "పుట్టిన తేదీ", offline: "ఆఫ్‌లైన్‌లో సేవ్ అయింది. కనెక్షన్ వచ్చినప్పుడు టోకెన్ సరిచేయబడుతుంది.", noDuplicate: "డెమో తనిఖీలో డూప్లికేట్ కనిపించలేదు." },
  hi: { title: "नया रोगी पंजीकरण", next: "जारी रखें", back: "पीछे", save: "पंजीकरण सहेजें", warning: "डेमो डेटा: यह निदान या उपचार नहीं है।", abha: "ABHA कैसे देंगे?", have: "मेरे पास ABHA है", none: "मेरे पास ABHA नहीं है", card: "आरोग्यश्री कार्ड (वैकल्पिक)", family: "परिवार के सदस्य", add: "सदस्य जोड़ें", details: "रोगी विवरण", ask: "दृष्टि से पूछें", hint: "बताएं क्या भरना है। आपकी पुष्टि के बाद ही ड्राफ्ट भरेगा।", prepare: "ड्राफ्ट तैयार करें", confirm: "पुष्टि करके भरें", check: "डुप्लिकेट जांच", consent: "सहमति", read: "जोर से पढ़ें", sign: "हस्ताक्षर या अंगूठे का निशान बनाएं", agree: "मैं पंजीकरण के लिए सहमत हूं", summary: "पंजीकरण सारांश", name: "पूरा नाम", phone: "फोन नंबर", address: "पता", dob: "जन्म तिथि", offline: "ऑफलाइन सहेजा गया। कनेक्शन पर अस्थायी टोकन बदलेगा।", noDuplicate: "डेमो जांच में संभावित डुप्लिकेट नहीं मिला।" },
} as const;
type Lang = keyof typeof labels;
type Member = PatientDraft["familyMembers"][number];
const messages = {
  en: { mandal: "Mandal", checking: "Checking for possible duplicates…", duplicate: "A possible matching record needs authorised staff review. Update the details or contact your administrator.", processing: "Working…", saveError: "Could not save this registration. Review the details and try again.", duplicateError: "Could not complete the duplicate check. Check your connection and try again.", provisionalToken: "Provisional token", reference: "Patient reference", savedOnline: "Registration saved to the patient registry." },
  te: { mandal: "మండలం", checking: "సంభావ్య డూప్లికేట్‌లను తనిఖీ చేస్తోంది…", duplicate: "సరిపోలే రికార్డు కనిపిస్తోంది. వివరాలను మార్చండి లేదా నిర్వాహకుడిని సంప్రదించండి.", processing: "పని జరుగుతోంది…", saveError: "నమోదును సేవ్ చేయలేకపోయాం. వివరాలను తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.", duplicateError: "డూప్లికేట్ తనిఖీ పూర్తి కాలేదు. కనెక్షన్‌ను తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.", provisionalToken: "తాత్కాలిక టోకెన్", reference: "రోగి సూచన", savedOnline: "నమోదు రోగి రిజిస్ట్రీలో సేవ్ అయింది." },
  hi: { mandal: "मंडल", checking: "संभावित डुप्लिकेट की जांच हो रही है…", duplicate: "संभावित मिलता-जुलता रिकॉर्ड मिला। विवरण बदलें या व्यवस्थापक से संपर्क करें।", processing: "काम जारी है…", saveError: "पंजीकरण सहेजा नहीं जा सका। विवरण जांचकर फिर कोशिश करें।", duplicateError: "डुप्लिकेट जांच पूरी नहीं हुई। कनेक्शन जांचकर फिर कोशिश करें।", provisionalToken: "अस्थायी टोकन", reference: "रोगी संदर्भ", savedOnline: "पंजीकरण रोगी रजिस्ट्री में सहेजा गया।" },
} as const;

export default function NewPatient() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const [lang, setLang] = useState<Lang>(() => {
    const saved = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
    return saved === "te" || saved === "hi" ? saved : "en";
  });
  useEffect(() => {
    const current = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
    if (current === "te" || current === "hi" || current === "en") setLang(current);
  }, [i18n.language, i18n.resolvedLanguage]);
  const t = labels[lang];
  const [step, setStep] = useState(0);
  const fieldForStep: RegistrationField[] = ["abha", "aarogyasri", "family", "name", "general", "consent", "summary"];
  useAssistantContext({ mode: "registration", field: fieldForStep[step] });
  const [draft, setDraft] = useState<PatientDraft>({ abhaChoice: "", name: "", phone: "", dateOfBirth: "", address: "", familyMembers: [], consent: false });
  const [question, setQuestion] = useState("");
  const [proposal, setProposal] = useState("");
  const [duplicate, setDuplicate] = useState<boolean | null>(null);
  const [fileName, setFileName] = useState("");
  const [cardFile, setCardFile] = useState<File>();
  const [token, setToken] = useState("");
  const [onlineSaved, setOnlineSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const copy = messages[lang];
  const update = (key: keyof PatientDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const switchLanguage = (language: Lang) => {
    setLang(language);
    localStorage.setItem("aarogya-language", language);
    void i18n.changeLanguage(language);
  };
  const updateMember = (index: number, key: keyof Member, value: string) => setDraft((d) => ({ ...d, familyMembers: d.familyMembers.map((m, i) => i === index ? { ...m, [key]: value } : m) }));
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => { const c = canvas.current; if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return; const r = c.getBoundingClientRect(); const x = event.clientX - r.left; const y = event.clientY - r.top; if (event.type === "pointerdown") { drawing.current = true; ctx.beginPath(); ctx.moveTo(x, y); } else if (event.type === "pointermove" && drawing.current) { ctx.lineTo(x, y); ctx.stroke(); } else drawing.current = false; };
  const next = async () => {
    if (busy) return;
    setError("");
    if (step === 1 && cardFile) {
      setBusy(true);
      try {
        await uploadAarogyasri(cardFile);
      } catch (requestError) {
        setError(getApiMessage(requestError, copy.saveError));
        return;
      } finally {
        setBusy(false);
      }
    }
    if (step === 4) {
      setBusy(true);
      try {
        const foundDuplicate = await checkPatientDuplicate(draft.phone, draft.name, draft.mandal ?? "");
        setDuplicate(foundDuplicate);
        if (foundDuplicate) return;
      } catch (requestError) {
        setError(getApiMessage(requestError, copy.duplicateError));
        return;
      } finally {
        setBusy(false);
      }
    }
    setStep((s) => Math.min(6, s + 1));
  };
  const save = async () => {
    setError("");
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const mandal = draft.mandal?.trim() ?? "";
    const dateOfBirth = draft.dateOfBirth.trim();
    const parsedDate = dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : undefined;
    if (name.length < 2 || name.length > 200) { setError("Enter a name between 2 and 200 characters."); return; }
    if (phone.length < 7 || phone.length > 20) { setError("Enter a valid phone number."); return; }
    if (!mandal || mandal.length > 100) { setError("Enter a mandal between 1 and 100 characters."); return; }
    if (draft.address.trim().length > 500) { setError("Address must be 500 characters or fewer."); return; }
    if (dateOfBirth && (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateOfBirth || parsedDate > new Date())) { setError("Enter a valid date of birth."); return; }
    if (!draft.consent) { setError("Patient consent is required to save this registration."); return; }

    setBusy(true);
    try {
      const registration = { ...draft, name, phone, mandal, dateOfBirth, preferredLanguage: lang };
      if (await isConnected()) {
        const result = await createPatientRegistration(registration);
        const patient = result.patient as { _id?: string; id?: string; patientCode?: string };
        setToken(patient.patientCode ?? patient._id ?? patient.id ?? "");
        setOnlineSaved(true);
      } else {
        setToken(await queuePatientRegistration(registration));
        setOnlineSaved(false);
      }
      setStep(6);
    } catch (requestError) {
      setError(getApiMessage(requestError, copy.saveError));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof PatientDraft, label: string, type = "text") => <label>{label}<input className="field" type={type} required={key === "name" || key === "phone" || key === "mandal"} maxLength={key === "address" ? 500 : key === "phone" ? 20 : key === "mandal" ? 100 : 200} max={type === "date" ? new Date().toISOString().slice(0, 10) : undefined} value={String(draft[key] ?? "")} onChange={(e) => update(key, e.target.value)} /></label>;
  const render = () => {
    if (step === 0) return <section><h2>{t.abha}</h2><div className="choice-grid"><button className={draft.abhaChoice === "yes" ? "choice choice-active" : "choice"} onClick={() => update("abhaChoice", "yes")} type="button">✓ {t.have}</button><button className={draft.abhaChoice === "no" ? "choice choice-active" : "choice"} onClick={() => update("abhaChoice", "no")} type="button">○ {t.none}</button></div>{draft.abhaChoice === "yes" && field("abhaId", "ABHA number")}</section>;
    if (step === 1) return <section><h2>{t.card}</h2><p>You may skip this step. Upload only with permission. Synthetic demo samples only; extraction is editable and never saved automatically.</p><input type="file" accept="image/*,.pdf" onChange={(e) => { const file = e.target.files?.[0]; setCardFile(file); setFileName(file?.name ?? ""); }} />{fileName && <p className="notice">Selected: {fileName}</p>}</section>;
    if (step === 2) return <section><h2>{t.family}</h2>{draft.familyMembers.map((m, i) => <div className="member-card" key={i}>{(["name", "relationship", "age"] as const).map((key) => <input className="field" key={key} aria-label={key} placeholder={key} value={m[key]} onChange={(e) => updateMember(i, key, e.target.value)} />)}</div>)}<button className="secondary" type="button" onClick={() => setDraft((d) => ({ ...d, familyMembers: [...d.familyMembers, { name: "", relationship: "", age: "" }] }))}>+ {t.add}</button></section>;
    if (step === 3) return <section><div className="assistant"><h2>{t.ask}</h2><p>{t.hint}</p><textarea className="field" value={question} onChange={(e) => setQuestion(e.target.value)} /><button className="secondary" type="button" onClick={() => setProposal(`Draft prepared from: ${question || "your request"}`)}>{t.prepare}</button>{proposal && <div className="notice"><p>{proposal}</p><button className="primary" type="button" onClick={() => { if (question.toLowerCase().includes("name")) update("name", question.split(":")[1]?.trim() ?? "Demo patient"); setProposal(""); }}>{t.confirm}</button></div>}<button className="secondary" type="button" onClick={() => setQuestion(`${question} (voice input convenience)`)}>🎙 Voice</button></div><h2>{t.details}</h2><div className="form-grid">{field("name", t.name)}{field("phone", t.phone, "tel")}{field("mandal", copy.mandal)}{field("dateOfBirth", t.dob, "date")}{field("address", t.address)}</div></section>;
    if (step === 4) return <section><h2>{t.check}</h2><p>{busy ? copy.checking : duplicate === null ? copy.checking : duplicate ? copy.duplicate : t.noDuplicate}</p></section>;
    if (step === 5) return <section><h2>{t.consent}</h2><p>This records information only; it is not medical advice or a diagnosis.</p><button className="secondary" type="button" onClick={() => window.speechSynthesis?.speak(new SpeechSynthesisUtterance("I consent to patient registration."))}>🔊 {t.read}</button><p>{t.sign}</p><canvas ref={canvas} className="signature" width={600} height={180} onPointerDown={draw} onPointerMove={draw} onPointerUp={draw} onPointerLeave={draw} /><label className="check"><input type="checkbox" checked={draft.consent} onChange={(e) => setDraft((d) => ({ ...d, consent: e.target.checked }))} />{t.agree}</label></section>;
    return <section><h2>{t.summary}</h2><dl className="summary"><dt>{t.name}</dt><dd>{draft.name || "—"}</dd><dt>{t.phone}</dt><dd>{draft.phone || "—"}</dd><dt>{t.family}</dt><dd>{draft.familyMembers.length}</dd></dl><p className="token">{onlineSaved ? copy.reference : copy.provisionalToken}: <strong>{token}</strong></p><p className="notice">{onlineSaved ? copy.savedOnline : t.offline}</p><button className="primary" type="button" onClick={() => navigate("/home")}>Done</button></section>;
  };
  return <><SimulationBanner /><main className="new-patient"><header className="page-header"><div><p className="eyebrow">Aarogya Drishti</p><h1>{t.title}</h1></div><LanguageSwitcher /></header><div className="language-tabs"><button type="button" aria-pressed={lang === "en"} onClick={() => switchLanguage("en")}>English</button><button type="button" aria-pressed={lang === "te"} onClick={() => switchLanguage("te")}>తెలుగు</button><button type="button" aria-pressed={lang === "hi"} onClick={() => switchLanguage("hi")}>हिन्दी</button></div><p className="warning">{t.warning}</p><nav className="steps" aria-label="Registration steps">{steps.map((s, i) => <span className={i === step ? "step-current" : i < step ? "step-done" : ""} key={s}><b>{i + 1}</b><small>{s}</small></span>)}</nav><div className="panel">{error && <p className="notice" role="alert">{error}</p>}{render()}<div className="actions">{step > 0 && step < 6 && <button className="secondary" type="button" disabled={busy} onClick={() => setStep(step - 1)}>{t.back}</button>}{step < 5 && <button className="primary" type="button" disabled={busy || (step === 0 && !draft.abhaChoice) || (step === 4 && duplicate === true)} onClick={next}>{busy ? copy.processing : t.next}</button>}{step === 5 && <button className="primary" type="button" disabled={!draft.consent || busy} onClick={save}>{busy ? copy.processing : t.save}</button>}</div></div></main></>;
}
