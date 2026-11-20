import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { enqueueOperation, encryptLocalText, isOfflineDataUnlocked, offlineDb, putEncryptedRecord, storeEncryptedImage } from "../../offline/db";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";
import { getPatientProfile } from "../patient/patientApi";
import api, { getApiMessage } from "../auth/api";
import { getDeviceId, syncNow } from "../../offline/sync";

type Stage = "habits" | "symptoms" | "emergency" | "camera" | "preview" | "summary" | "coach";
type Lang = "en" | "te" | "hi";
type GeminiObservationResponse =
  | { status: "completed"; imageQuality: "adequate" | "limited" | "uncertain"; visibleDescription: string; model: string; processedAt: string }
  | { status: "consent_required" | "provider_unavailable" | "unavailable" };

async function supportedImage(blob: Blob) {
  if (blob.type === "image/jpeg" || blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image conversion is unavailable.");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((imageBlob) => imageBlob ? resolve(imageBlob) : reject(new Error("Image conversion failed.")), "image/jpeg", 0.9));
}

const words: Record<Lang, Record<string, string>> = {
  en: {
    title: "Community case check", habits: "Habits", symptoms: "Symptoms", camera: "Camera guide",
    loading: "Loading your patient record…", patientUnavailable: "Your patient record and screening consent must be confirmed before saving.",
    pinRequired: "Set or unlock your offline PIN to securely save this screening, then try again.",
    patientIdRequired: "Enter the assigned patient record ID before submitting this case.",
    imageRequired: "Capture or choose an image before submitting this screening.",
    qualityChecking: "Checking image quality…",
    qualityCheckError: "Unable to check image quality. You can still submit it for clinician review.",
    consentRequired: "Screening consent is required before recording answers or images. You can review it before continuing.",
    reviewConsent: "Review screening consent",
    summaryHabits: "Reported habits",
    summarySymptoms: "Reported symptoms",
    summaryImage: "Image",
    noSymptoms: "No symptoms selected",
    noHabits: "No tobacco or alcohol use reported",
    imageReady: "Selected on this device; upload and Gemini analysis start when submitted",
    imageUploaded: "Uploaded for clinician review",
    imageMissing: "No image attached",
    geminiPending: "Gemini analysis runs after the image is submitted. The local preview is not sent to Google.",
    geminiTitle: "Gemini visual observation",
    geminiQuality: "Image quality",
    adequate: "adequate", limited: "limited", uncertain: "uncertain",
    geminiDisclaimer: "Unvalidated and not a diagnosis. A qualified clinician must independently review the image.",
    geminiConsentRequired: "Gemini analysis was not run because external-AI consent is not active.",
    geminiManageConsent: "Manage consent in privacy settings",
    geminiProviderUnavailable: "Gemini is not configured. Add GEMINI_API_KEY to the project root .env file and restart the API.",
    geminiUnavailable: "Gemini could not complete its observation. The image remains available for clinician review.",
    savePlan: "Save this support step",
    planSaved: "Your cessation support step was saved.",
    planSaveError: "Unable to save the support step. Check your connection and try again.",
    selectCoach: "Choose one support step first.",
    submittedRecord: "Submitted for clinician review",
    onlineSave: "Submitting securely…",
    reviewStatus: "Clinical review",
    notSubmitted: "Not submitted",
    summary: "Review summary", coach: "Cessation coach", next: "Continue", back: "Back",
    save: "Save offline", submit: "Submit when connected", saved: "Saved on this device",
    tobacco: "Tobacco use", alcohol: "Alcohol use", smoke: "Smoking or chewing", none: "None",
    daily: "Daily", sometimes: "Sometimes", cough: "Cough lasting more than two weeks",
    mouth: "Mouth sore or patch that does not heal", swallow: "Difficulty swallowing",
    voice: "Voice change lasting more than two weeks", weight: "Unexpected weight change",
    redFlag: "A symptom was selected. This check is not a diagnosis. If symptoms are severe or immediate, contact emergency services.",
    callOfficer: "Call medical officer", call108: "Call 108 emergency", site: "Capture site",
    oral: "Mouth", skin: "Skin", throat: "Throat", coaching: "Hold the phone steady. Use bright, even light.",
    light: "Light meter", goodLight: "Good light", moreLight: "Move to brighter light",
    capture: "Capture image", chooseFile: "Choose an image", preview: "Image preview",
    quality: "Image quality", acceptable: "Ready for review", recapture: "Recapture",
    review: "Review needed", ai: "AI review status", notAssessed: "Not assessed",
    pending: "Review pending", reviewed: "Clinician review needed", band: "Risk band",
    reasons: "Reasons to discuss with a clinician", reason1: "A reported symptom needs a closer look",
    reason2: "A habit history may affect follow-up planning", noScore: "This summary guides follow-up; it is not a diagnosis or a score.",
    emergencyTitle: "Urgent help", emergencyText: "Please stay with the person and contact a medical officer or emergency services.",
    coachText: "Small steps can help reduce tobacco use. Choose one step for today.",
    coach1: "Delay the next use by 10 minutes", coach2: "Tell a trusted family member", coach3: "Ask the medical officer about support",
    start: "Start a new case", close: "Return to dashboard", cameraUnavailable: "Camera access is unavailable. Allow camera access or choose an image.",
    imageInvalid: "Choose a JPEG, PNG, or WebP image smaller than 9 MB.", saving: "Saving…", submitting: "Submitting…",
    savedQueued: "Saved securely on this device. It will sync when a connection is available.", submitted: "Screening submitted for clinician review.",
    syncFailed: "Saved on this device, but submission failed. Try again when connected.", tobaccoUse: "Tobacco use", alcoholUse: "Alcohol use",
    tongue: "Tongue", gums: "Gums", innerCheek: "Inner cheek", lips: "Lips", palate: "Palate", floorOfMouth: "Floor of mouth", otherOralArea: "Other oral area",
    downloadReport: "Download screening report", reportUnavailable: "The report could not be generated. Please try again.",
    reportRiskNotAssessed: "Image-based risk is not assessed by this demonstration. A clinician must determine follow-up priority.",
  },
  te: {
    title: "సమాజ ఆరోగ్య కేసు", habits: "అలవాట్లు", symptoms: "లక్షణాలు", camera: "కెమెరా గైడ్",
    loading: "మీ రోగి వివరాలు లోడ్ అవుతున్నాయి…", patientUnavailable: "సేవ్ చేయడానికి ముందు మీ రోగి వివరాలు మరియు స్క్రీనింగ్ సమ్మతి నిర్ధారించాలి.",
    pinRequired: "ఈ స్క్రీనింగ్‌ను సురక్షితంగా సేవ్ చేయడానికి ఆఫ్‌లైన్ పిన్ సెట్ చేయండి లేదా తెరవండి; ఆపై మళ్లీ ప్రయత్నించండి.",
    patientIdRequired: "ఈ కేసును పంపే ముందు కేటాయించిన రోగి రికార్డు ఐడీ నమోదు చేయండి.",
    imageRequired: "ఈ స్క్రీనింగ్‌ను పంపే ముందు చిత్రాన్ని తీయండి లేదా ఎంచుకోండి.",
    qualityChecking: "చిత్ర నాణ్యతను తనిఖీ చేస్తోంది…",
    qualityCheckError: "చిత్ర నాణ్యతను తనిఖీ చేయలేకపోయాము. అయినప్పటికీ వైద్యుడి సమీక్ష కోసం పంపవచ్చు.",
    consentRequired: "సమాధానాలు లేదా చిత్రాలను నమోదు చేయడానికి ముందు స్క్రీనింగ్ సమ్మతి అవసరం. కొనసాగించే ముందు దాన్ని సమీక్షించండి.",
    reviewConsent: "స్క్రీనింగ్ సమ్మతిని సమీక్షించండి",
    summaryHabits: "నివేదించిన అలవాట్లు",
    summarySymptoms: "నివేదించిన లక్షణాలు",
    summaryImage: "చిత్రం",
    noSymptoms: "లక్షణాలు ఎంచుకోలేదు",
    noHabits: "పొగాకు లేదా మద్యం వినియోగం లేదని తెలిపారు",
    imageReady: "ఈ పరికరంలో ఎంచుకోబడింది; పంపిన తర్వాత అప్‌లోడ్ మరియు Gemini విశ్లేషణ ప్రారంభమవుతాయి",
    imageUploaded: "వైద్యుడి సమీక్ష కోసం అప్‌లోడ్ చేయబడింది",
    imageMissing: "చిత్రం జోడించలేదు",
    geminiPending: "చిత్రాన్ని పంపిన తర్వాత Gemini విశ్లేషణ జరుగుతుంది. స్థానిక ప్రివ్యూ Googleకు పంపబడదు.",
    geminiTitle: "Gemini దృశ్య పరిశీలన",
    geminiQuality: "చిత్ర నాణ్యత",
    adequate: "సరిపడినది", limited: "పరిమితమైనది", uncertain: "నిశ్చయంగా తెలియదు",
    geminiDisclaimer: "ఇది ధృవీకరించని పరిశీలన మాత్రమే, నిర్ధారణ కాదు. అర్హత కలిగిన వైద్యుడు చిత్రాన్ని స్వతంత్రంగా సమీక్షించాలి.",
    geminiConsentRequired: "బాహ్య AI సమ్మతి సక్రియంగా లేనందున Gemini విశ్లేషణ జరగలేదు.",
    geminiManageConsent: "గోప్యత సెట్టింగ్‌లలో సమ్మతిని నిర్వహించండి",
    geminiProviderUnavailable: "Gemini కాన్ఫిగర్ చేయబడలేదు. ప్రాజెక్ట్ రూట్ .env ఫైల్‌లో GEMINI_API_KEY జోడించి APIని మళ్లీ ప్రారంభించండి.",
    geminiUnavailable: "Gemini పరిశీలనను పూర్తి చేయలేకపోయింది. చిత్రం వైద్యుడి సమీక్షకు అందుబాటులో ఉంటుంది.",
    savePlan: "ఈ సహాయక అడుగును సేవ్ చేయండి",
    planSaved: "మీ విరమణ సహాయక అడుగు సేవ్ అయింది.",
    planSaveError: "సహాయక అడుగును సేవ్ చేయలేకపోయాము. కనెక్షన్‌ను తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.",
    selectCoach: "ముందుగా ఒక సహాయక అడుగును ఎంచుకోండి.",
    submittedRecord: "వైద్యుడి సమీక్ష కోసం పంపబడింది",
    onlineSave: "సురక్షితంగా పంపుతోంది…",
    reviewStatus: "వైద్య సమీక్ష",
    notSubmitted: "ఇంకా పంపలేదు",
    summary: "సారాంశం", coach: "విడిచే మార్గదర్శి", next: "కొనసాగించండి", back: "వెనుకకు",
    save: "ఆఫ్‌లైన్‌లో సేవ్ చేయండి", submit: "కనెక్షన్ ఉన్నప్పుడు పంపండి", saved: "ఈ పరికరంలో సేవ్ అయింది",
    tobacco: "పొగాకు వినియోగం", alcohol: "మద్యం వినియోగం", smoke: "పొగ త్రాగడం లేదా నమలడం", none: "ఏదీ లేదు",
    daily: "రోజూ", sometimes: "కొన్నిసార్లు", cough: "రెండు వారాలకంటే ఎక్కువ దగ్గు", mouth: "నయం కాని నోటి పుండు లేదా మచ్చ",
    swallow: "మింగడంలో ఇబ్బంది", voice: "రెండు వారాలకంటే ఎక్కువ గొంతు మార్పు", weight: "అనుకోని బరువు మార్పు",
    redFlag: "ఒక లక్షణాన్ని ఎంచుకున్నారు. ఇది నిర్ధారణ కాదు. లక్షణాలు తీవ్రమైతే లేదా తక్షణ ప్రమాదం ఉంటే అత్యవసర సేవలను సంప్రదించండి.", callOfficer: "వైద్య అధికారికి కాల్",
    call108: "108 అత్యవసర కాల్", site: "చిత్ర స్థలం", oral: "నోరు", skin: "చర్మం", throat: "గొంతు",
    coaching: "ఫోన్‌ను స్థిరంగా పట్టుకోండి. సమానమైన వెలుతురు వాడండి.", light: "వెలుతురు మీటర్", goodLight: "మంచి వెలుతురు",
    moreLight: "మరింత వెలుతురు ఉన్న చోటికి వెళ్లండి", capture: "చిత్రం తీయండి", chooseFile: "చిత్రం ఎంచుకోండి",
    preview: "చిత్రం ప్రివ్యూ", quality: "చిత్ర నాణ్యత", acceptable: "సమీక్షకు సిద్ధం", recapture: "మళ్లీ తీయండి",
    review: "సమీక్ష అవసరం", ai: "AI సమీక్ష స్థితి", notAssessed: "ఇంకా అంచనా లేదు", pending: "సమీక్ష పెండింగ్",
    reviewed: "వైద్యుడి సమీక్ష అవసరం", band: "ప్రమాద స్థాయి", reasons: "వైద్యుడితో చర్చించాల్సిన కారణాలు",
    reason1: "నివేదించిన లక్షణానికి మరింత పరిశీలన అవసరం", reason2: "అలవాట్ల చరిత్ర తదుపరి ప్రణాళికపై ప్రభావం చూపవచ్చు",
    noScore: "ఈ సారాంశం తదుపరి సంరక్షణకు మాత్రమే; ఇది నిర్ధారణ లేదా స్కోర్ కాదు.", emergencyTitle: "అత్యవసర సహాయం",
    emergencyText: "వ్యక్తితో ఉండి వైద్య అధికారిని లేదా అత్యవసర సేవలను సంప్రదించండి.", coachText: "పొగాకును తగ్గించడానికి చిన్న అడుగులు సహాయపడతాయి.",
    coach1: "తదుపరి వినియోగాన్ని 10 నిమిషాలు ఆలస్యం చేయండి", coach2: "నమ్మకమైన కుటుంబ సభ్యునికి చెప్పండి",
    coach3: "సహాయం గురించి వైద్య అధికారిని అడగండి", start: "కొత్త కేసు ప్రారంభించండి", close: "డాష్‌బోర్డ్‌కు తిరిగి",
    cameraUnavailable: "కెమెరా అందుబాటులో లేదు. కెమెరా అనుమతించండి లేదా చిత్రాన్ని ఎంచుకోండి.",
    imageInvalid: "9 MB కంటే చిన్న JPEG, PNG లేదా WebP చిత్రాన్ని ఎంచుకోండి.", saving: "సేవ్ అవుతోంది…", submitting: "పంపుతోంది…",
    savedQueued: "ఈ పరికరంలో సురక్షితంగా సేవ్ అయింది. కనెక్షన్ వచ్చినప్పుడు సమకాలీకరించబడుతుంది.",
    submitted: "వైద్యుడి సమీక్ష కోసం స్క్రీనింగ్ పంపబడింది.", syncFailed: "ఈ పరికరంలో సేవ్ అయింది, కానీ పంపడం విఫలమైంది. కనెక్షన్ ఉన్నప్పుడు మళ్లీ ప్రయత్నించండి.",
    tobaccoUse: "పొగాకు వినియోగం", alcoholUse: "మద్యం వినియోగం",
    tongue: "నాలుక", gums: "చిగుళ్లు", innerCheek: "లోపలి చెంప", lips: "పెదవులు", palate: "అంగిలి", floorOfMouth: "నోటి అడుగు భాగం", otherOralArea: "ఇతర నోటి భాగం",
    downloadReport: "స్క్రీనింగ్ నివేదికను డౌన్‌లోడ్ చేయండి", reportUnavailable: "నివేదికను రూపొందించలేకపోయాము. మళ్లీ ప్రయత్నించండి.",
    reportRiskNotAssessed: "ఈ అనుకరణలో చిత్రం ఆధారంగా ప్రమాదాన్ని అంచనా వేయరు. తదుపరి సంరక్షణ ప్రాధాన్యతను వైద్యుడు నిర్ణయించాలి.",
  },
  hi: {
    title: "समुदाय स्वास्थ्य केस", habits: "आदतें", symptoms: "लक्षण", camera: "कैमरा गाइड", summary: "सारांश",
    loading: "आपका मरीज रिकॉर्ड लोड हो रहा है…", patientUnavailable: "सेव करने से पहले आपके मरीज रिकॉर्ड और स्क्रीनिंग सहमति की पुष्टि आवश्यक है।",
    pinRequired: "इस स्क्रीनिंग को सुरक्षित रूप से सेव करने के लिए ऑफ़लाइन PIN सेट करें या अनलॉक करें, फिर दोबारा कोशिश करें।",
    patientIdRequired: "इस केस को भेजने से पहले निर्धारित मरीज रिकॉर्ड ID दर्ज करें।",
    imageRequired: "इस स्क्रीनिंग को भेजने से पहले तस्वीर लें या चुनें।",
    qualityChecking: "तस्वीर की गुणवत्ता जाँची जा रही है…",
    qualityCheckError: "तस्वीर की गुणवत्ता जाँची नहीं जा सकी। फिर भी इसे चिकित्सक समीक्षा के लिए भेज सकते हैं।",
    consentRequired: "जवाब या तस्वीर दर्ज करने से पहले स्क्रीनिंग सहमति आवश्यक है। आगे बढ़ने से पहले इसे पढ़ें।",
    reviewConsent: "स्क्रीनिंग सहमति पढ़ें",
    summaryHabits: "बताई गई आदतें",
    summarySymptoms: "बताए गए लक्षण",
    summaryImage: "तस्वीर",
    noSymptoms: "कोई लक्षण नहीं चुना गया",
    noHabits: "तंबाकू या शराब का उपयोग नहीं बताया गया",
    imageReady: "इस डिवाइस पर चुनी गई; भेजने के बाद अपलोड और Gemini विश्लेषण शुरू होगा",
    imageUploaded: "चिकित्सक समीक्षा के लिए अपलोड की गई",
    imageMissing: "कोई तस्वीर संलग्न नहीं है",
    geminiPending: "तस्वीर भेजने के बाद Gemini विश्लेषण होगा। स्थानीय पूर्वावलोकन Google को नहीं भेजा जाता।",
    geminiTitle: "Gemini दृश्य अवलोकन",
    geminiQuality: "तस्वीर की गुणवत्ता",
    adequate: "पर्याप्त", limited: "सीमित", uncertain: "अनिश्चित",
    geminiDisclaimer: "यह अप्रमाणित अवलोकन है, निदान नहीं। योग्य चिकित्सक को तस्वीर की स्वतंत्र समीक्षा करनी चाहिए।",
    geminiConsentRequired: "बाहरी-AI सहमति सक्रिय नहीं है, इसलिए Gemini विश्लेषण नहीं हुआ।",
    geminiManageConsent: "गोपनीयता सेटिंग में सहमति प्रबंधित करें",
    geminiProviderUnavailable: "Gemini कॉन्फ़िगर नहीं है। प्रोजेक्ट की रूट .env फ़ाइल में GEMINI_API_KEY जोड़ें और API रीस्टार्ट करें।",
    geminiUnavailable: "Gemini अवलोकन पूरा नहीं कर सका। तस्वीर चिकित्सक समीक्षा के लिए उपलब्ध है।",
    savePlan: "यह सहायता चरण सेव करें",
    planSaved: "आपका छोड़ने का सहायता चरण सेव हो गया।",
    planSaveError: "सहायता चरण सेव नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।",
    selectCoach: "पहले एक सहायता चरण चुनें।",
    submittedRecord: "चिकित्सक समीक्षा के लिए भेजा गया",
    onlineSave: "सुरक्षित रूप से भेजा जा रहा है…",
    reviewStatus: "चिकित्सक समीक्षा",
    notSubmitted: "अभी नहीं भेजा",
    coach: "छोड़ने की मदद", next: "आगे", back: "पीछे", save: "ऑफ़लाइन सेव करें", submit: "कनेक्शन पर भेजें",
    saved: "इस डिवाइस पर सेव हुआ", tobacco: "तंबाकू उपयोग", alcohol: "शराब उपयोग", smoke: "धूम्रपान या चबाना",
    none: "कोई नहीं", daily: "रोज़", sometimes: "कभी-कभी", cough: "दो सप्ताह से अधिक खाँसी",
    mouth: "न भरने वाला मुँह का घाव या निशान", swallow: "निगलने में कठिनाई", voice: "दो सप्ताह से अधिक आवाज़ में बदलाव",
    weight: "अचानक वजन में बदलाव", redFlag: "एक लक्षण चुना गया है। यह निदान नहीं है। लक्षण गंभीर हों या तत्काल खतरा हो तो आपात सेवा से संपर्क करें।",
    callOfficer: "चिकित्सा अधिकारी को कॉल", call108: "108 आपातकालीन कॉल", site: "चित्र स्थान", oral: "मुँह", skin: "त्वचा",
    throat: "गला", coaching: "फोन स्थिर रखें। समान और पर्याप्त रोशनी रखें।", light: "रोशनी मीटर", goodLight: "अच्छी रोशनी",
    moreLight: "अधिक रोशनी वाली जगह जाएँ", capture: "चित्र लें", chooseFile: "चित्र चुनें", preview: "चित्र पूर्वावलोकन",
    quality: "चित्र गुणवत्ता", acceptable: "समीक्षा के लिए तैयार", recapture: "फिर से लें", review: "समीक्षा चाहिए",
    ai: "AI समीक्षा स्थिति", notAssessed: "अभी आकलन नहीं", pending: "समीक्षा लंबित", reviewed: "चिकित्सक समीक्षा चाहिए",
    band: "जोखिम स्तर", reasons: "चिकित्सक से चर्चा के कारण", reason1: "बताए गए लक्षण पर अधिक ध्यान चाहिए",
    reason2: "आदतों का इतिहास आगे की योजना में मदद कर सकता है", noScore: "यह सारांश आगे की देखभाल के लिए है; यह निदान या स्कोर नहीं है।",
    emergencyTitle: "तुरंत मदद", emergencyText: "व्यक्ति के साथ रहें और चिकित्सा अधिकारी या आपात सेवा से संपर्क करें।",
    coachText: "तंबाकू कम करने में छोटे कदम मदद करते हैं। आज एक कदम चुनें।", coach1: "अगले उपयोग को 10 मिनट टालें",
    coach2: "किसी भरोसेमंद परिवार सदस्य को बताएँ", coach3: "सहायता के बारे में चिकित्सा अधिकारी से पूछें",
    start: "नया केस शुरू करें", close: "डैशबोर्ड पर लौटें",
    cameraUnavailable: "कैमरा उपलब्ध नहीं है। कैमरा अनुमति दें या कोई चित्र चुनें।",
    imageInvalid: "9 MB से छोटी JPEG, PNG या WebP तस्वीर चुनें।", saving: "सेव हो रहा है…", submitting: "भेजा जा रहा है…",
    savedQueued: "इस डिवाइस पर सुरक्षित रूप से सेव हुआ। कनेक्शन मिलने पर सिंक होगा।",
    submitted: "स्क्रीनिंग चिकित्सक की समीक्षा के लिए भेजी गई।", syncFailed: "इस डिवाइस पर सेव हुआ, लेकिन भेजना विफल रहा। कनेक्शन मिलने पर फिर कोशिश करें।",
    tobaccoUse: "तंबाकू उपयोग", alcoholUse: "शराब उपयोग",
    tongue: "जीभ", gums: "मसूड़े", innerCheek: "गाल का अंदरूनी भाग", lips: "होंठ", palate: "तालु", floorOfMouth: "मुंह का तल", otherOralArea: "मुंह का अन्य भाग",
    downloadReport: "स्क्रीनिंग रिपोर्ट डाउनलोड करें", reportUnavailable: "रिपोर्ट नहीं बन सकी। कृपया फिर कोशिश करें।",
    reportRiskNotAssessed: "इस डेमो में तस्वीर से जोखिम का आकलन नहीं किया जाता। आगे की देखभाल की प्राथमिकता चिकित्सक तय करें।",
  },
};

export default function CaseFlow() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const lang = (i18n.language.slice(0, 2) as Lang) in words ? i18n.language.slice(0, 2) as Lang : "en";
  const t = (key: string) => words[lang][key] ?? words.en[key] ?? key;
  const [stage, setStage] = useState<Stage>("habits");
  const [habit, setHabit] = useState("none");
  const [alcohol, setAlcohol] = useState("none");
  const [selectedCoach, setSelectedCoach] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [site, setSite] = useState("tongue");
  const [streaming, setStreaming] = useState(false);
  const [image, setImage] = useState<string>();
  const [imageUploaded, setImageUploaded] = useState(false);
  const [geminiObservation, setGeminiObservation] = useState<GeminiObservationResponse>();
  const [quality, setQuality] = useState<"review" | "acceptable">("review");
  const [patientId, setPatientId] = useState("");
  const [offlineMessage, setOfflineMessage] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [saving, setSaving] = useState(false);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState("");
  const [patientReady, setPatientReady] = useState(false);
  const [consentRequired, setConsentRequired] = useState(false);
  const [submittedCaseId, setSubmittedCaseId] = useState("");
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);
  const [checkingQuality, setCheckingQuality] = useState(false);
  const [reportSaving, setReportSaving] = useState(false);
  const [caseClientUuid, setCaseClientUuid] = useState(() => {
    const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
    const key = `aarogya-case-client-uuid-${ownerId}`;
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = crypto.randomUUID();
    localStorage.setItem(key, value);
    return value;
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);

  useEffect(() => {
    if (user?.role !== "patient") return;
    let active = true;
    setPatientReady(false);
    setPatientLoading(true);
    void getPatientProfile().then(async (profile) => {
      if (!active) return;
      setPatientId(profile.id);
      const { data } = await api.get<{ granted: boolean }>(`/patients/${profile.id}/consents/screening`);
      if (active && !data.granted) setConsentRequired(true);
      else if (active) { setConsentRequired(false); setPatientReady(true); }
    }).catch((error: unknown) => {
      if (active) setPatientError(getApiMessage(error, "Unable to load your patient record."));
    }).finally(() => { if (active) setPatientLoading(false); });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!streaming || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setCameraError(words[lang].cameraUnavailable));
  }, [streaming, lang]);
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => {
    if (!image?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(image);
  }, [image]);
  const toggleSymptom = (symptom: string) => setSymptoms((current) => current.includes(symptom) ? current.filter((item) => item !== symptom) : [...current, symptom]);
  const redFlag = symptoms.length > 0;
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  };
  const startCamera = async () => {
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = next;
      setStreaming(true);
    } catch {
      setCameraError(t("cameraUnavailable"));
    }
  };
  const assessImageQuality = async (blob: Blob) => {
    if (!patientId || user?.role !== "patient") return;
    setCheckingQuality(true);
    setCameraError("");
    try {
      const form = new FormData();
      form.append("image", await supportedImage(blob), "community-screening.jpg");
      form.append("patientId", patientId);
      const { data } = await api.post<{ pass: boolean }>("/ai/quality-check", form, { headers: { "Content-Type": "multipart/form-data" } });
      setQuality(data.pass ? "acceptable" : "review");
    } catch (error) {
      setQuality("review");
      setCameraError(getApiMessage(error, t("qualityCheckError")));
    } finally {
      setCheckingQuality(false);
    }
  };
  const capture = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setCameraError(t("cameraUnavailable"));
      return;
    }
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    setImage(dataUrl);
    setImageUploaded(false);
    setGeminiObservation(undefined);
    setQuality("review");
    stopCamera();
    setStage("preview");
    void fetch(dataUrl).then((response) => response.blob()).then((blob) => assessImageQuality(blob)).catch((error: unknown) => {
      setCameraError(getApiMessage(error, t("qualityCheckError")));
    });
  };
  const save = async () => {
    if (saving) return;
    if (user?.role === "patient" && !patientReady) {
      setPatientError(t("patientUnavailable"));
      return;
    }
    if (user?.role !== "patient" && !patientId.trim()) {
      setPatientError(t("patientIdRequired"));
      return;
    }
    if (!isOfflineDataUnlocked()) {
      setPatientError(t("pinRequired"));
      window.dispatchEvent(new CustomEvent("aarogya-open-pin-setup"));
      return;
    }
    setSaving(true);
    setOfflineMessage("");
    setPatientError("");
    const savedAt = new Date().toISOString();
    try {
      const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
      const draftKey = `aarogya-case-draft-${ownerId}`;
      const caseUuidKey = `aarogya-case-client-uuid-${ownerId}`;
      const caseDraft = { habit, alcohol, symptoms, site, savedAt, patientId };
      localStorage.setItem(draftKey, await encryptLocalText(JSON.stringify(caseDraft)));
      const caseUuid = caseClientUuid;
      localStorage.setItem(caseUuidKey, caseUuid);
      if (patientId.trim()) {
        const operation = await enqueueOperation("create_case", { patientId: patientId.trim(), notes: JSON.stringify({ habit, alcohol, symptoms, site }) }, caseUuid);
        await putEncryptedRecord(offlineDb.cases, { clientUuid: operation.clientUuid, ownerId, patientId: patientId.trim(), habit, alcohol, symptoms, site, status: "saved_offline", updatedAt: savedAt });
        const stableOperationId = (key: string) => {
          const storageKey = `aarogya-op-${caseUuid}-${key}`;
          const stored = localStorage.getItem(storageKey);
          if (stored) return stored;
          const value = crypto.randomUUID();
          localStorage.setItem(storageKey, value);
          return value;
        };
        for (const [key, name, frequency] of [
          ["tobacco", t("tobaccoUse"), habit],
          ["alcohol", t("alcoholUse"), alcohol]
        ]) {
          if (frequency === "none") continue;
          const habitOperation = await enqueueOperation("create_habit", { patientId: patientId.trim(), name, frequency }, stableOperationId(key));
          await putEncryptedRecord(offlineDb.habits, { clientUuid: habitOperation.clientUuid, ownerId, patientId: patientId.trim(), name, frequency, createdAt: savedAt });
        }
        for (const [index, symptom] of symptoms.entries()) {
          const symptomOperation = await enqueueOperation("create_symptom", { patientId: patientId.trim(), name: symptom }, stableOperationId(`symptom-${index}-${symptom}`));
          await putEncryptedRecord(offlineDb.symptoms, { clientUuid: symptomOperation.clientUuid, ownerId, patientId: patientId.trim(), name: symptom, createdAt: savedAt });
        }
      } else {
        await putEncryptedRecord(offlineDb.cases, { clientUuid: caseUuid, ownerId, ...caseDraft, status: "saved_offline" });
      }
      if (image) {
        const response = await fetch(image);
        const blob = await response.blob();
        try { await storeEncryptedImage(blob, caseUuid, `case-${caseUuid}.jpg`); }
        catch (error) {
          setOfflineMessage(error instanceof Error ? error.message : "Image was not saved offline.");
          setStage("summary");
          return undefined;
        }
      }
      setStage("summary");
      return caseUuid;
    } catch (error) {
      setPatientError(getApiMessage(error, "Unable to save this screening. Unlock offline storage and try again."));
      return undefined;
    } finally {
      setSaving(false);
    }
  };
  const submit = async () => {
    if (user?.role === "patient" && navigator.onLine) {
      await submitPatientOnline();
      return;
    }
    const caseUuid = await save();
    if (!caseUuid) return;
    if (!navigator.onLine) {
      setOfflineMessage(t("savedQueued"));
      return;
    }
    setSaving(true);
    try {
      await syncNow();
      const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
      const [caseOperation, pendingImages] = await Promise.all([
        offlineDb.outbox.where("clientUuid").equals(caseUuid).first(),
        offlineDb.caseImages.where("caseClientUuid").equals(caseUuid).filter((item) => item.ownerId === ownerId).count()
      ]);
      if (caseOperation?.status === "synced" && pendingImages === 0) {
        localStorage.setItem("aarogya-case-submitted", new Date().toISOString());
        setOfflineMessage(t("submitted"));
      } else {
        setOfflineMessage(caseOperation?.error ? `${t("syncFailed")} (${caseOperation.error})` : t("syncFailed"));
      }
    } catch (error) {
      setOfflineMessage(error instanceof Error ? `${t("syncFailed")} ${error.message}` : t("syncFailed"));
    } finally {
      setSaving(false);
    }
  };
  const submitPatientOnline = async () => {
    if (saving || !patientReady || !patientId) {
      setPatientError(t("patientUnavailable"));
      return;
    }
    if (!image) {
      setPatientError(t("imageRequired"));
      return;
    }
    setSaving(true);
    setPatientError("");
    setOfflineMessage("");
    try {
      const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
      const caseUuid = caseClientUuid;
      const operationId = (key: string) => {
        const storageKey = `aarogya-op-${caseUuid}-${key}`;
        const existing = localStorage.getItem(storageKey);
        if (existing) return existing;
        const value = crypto.randomUUID();
        localStorage.setItem(storageKey, value);
        return value;
      };
      const operations: Array<{ clientUuid: string; opType: string; payload: Record<string, unknown> }> = [{
        clientUuid: caseUuid,
        opType: "create_case",
        payload: { patientId, notes: JSON.stringify({ habit, alcohol, symptoms, site }) }
      }];
      if (habit !== "none") operations.push({
        clientUuid: operationId("tobacco"),
        opType: "create_habit",
        payload: { patientId, name: t("tobaccoUse"), frequency: habit }
      });
      if (alcohol !== "none") operations.push({
        clientUuid: operationId("alcohol"),
        opType: "create_habit",
        payload: { patientId, name: t("alcoholUse"), frequency: alcohol }
      });
      for (const [index, symptom] of symptoms.entries()) operations.push({
        clientUuid: operationId(`symptom-${index}-${symptom}`),
        opType: "create_symptom",
        payload: { patientId, name: t(symptom) }
      });
      const { data } = await api.post<{ results: Array<{ clientUuid: string; status: string; entityId?: string; code?: string }> }>("/sync/batch", { operations }, {
        headers: { "X-Device-Id": getDeviceId(), "Idempotency-Key": `case-submit-${caseUuid}-${crypto.randomUUID()}` }
      });
      const caseResult = data.results.find((result) => result.clientUuid === caseUuid);
      const failedOperation = data.results.find((result) => result.status !== "synced");
      if (failedOperation || caseResult?.status !== "synced" || !caseResult.entityId) {
        throw new Error(failedOperation?.code ?? caseResult?.code ?? t("patientUnavailable"));
      }
      setSubmittedCaseId(caseResult.entityId);
      const imageResponse = await fetch(image);
      if (!imageResponse.ok) throw new Error(t("imageRequired"));
      const uploadBlob = await supportedImage(await imageResponse.blob());
      const form = new FormData();
      form.append("image", uploadBlob, "community-screening.jpg");
      const { data: uploadResult } = await api.post<{ geminiObservation: GeminiObservationResponse }>(`/cases/${caseResult.entityId}/images`, form, { headers: { "Content-Type": "multipart/form-data" } });
      setImageUploaded(true);
      setGeminiObservation(uploadResult.geminiObservation);
      setOfflineMessage(t("submitted"));
      localStorage.setItem("aarogya-case-submitted", new Date().toISOString());
      const nextCaseUuid = crypto.randomUUID();
      localStorage.setItem(`aarogya-case-client-uuid-${ownerId}`, nextCaseUuid);
    } catch (error) {
      setPatientError(getApiMessage(error, "") || (error instanceof Error ? error.message : t("syncFailed")));
    } finally {
      setSaving(false);
    }
  };
  const saveCessationPlan = async () => {
    if (!selectedCoach) {
      setPatientError(t("selectCoach"));
      return;
    }
    if (!patientId || !navigator.onLine) {
      setPatientError(t("planSaveError"));
      return;
    }
    setPlanSaving(true);
    setPatientError("");
    try {
      await api.post(`/patients/${patientId}/cessation-plans`, {
        goal: selectedCoach,
        steps: [selectedCoach]
      });
      setPlanSaved(true);
    } catch (error) {
      setPatientError(getApiMessage(error, t("planSaveError")));
    } finally {
      setPlanSaving(false);
    }
  };
  const downloadReport = async () => {
    if (!submittedCaseId || reportSaving) return;
    setReportSaving(true);
    setPatientError("");
    try {
      const { data } = await api.get<Blob>(`/cases/${submittedCaseId}/screening-report`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `oral-screening-${submittedCaseId.slice(-8)}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setPatientError(getApiMessage(error, t("reportUnavailable")));
    } finally {
      setReportSaving(false);
    }
  };
  const beginNewCase = () => {
    const ownerId = localStorage.getItem("aarogya-offline-owner-id") ?? "";
    const nextCaseUuid = crypto.randomUUID();
    localStorage.setItem(`aarogya-case-client-uuid-${ownerId}`, nextCaseUuid);
    setCaseClientUuid(nextCaseUuid);
    setHabit("none");
    setAlcohol("none");
    setSymptoms([]);
    setSite("tongue");
    setImage(undefined);
    setImageUploaded(false);
    setGeminiObservation(undefined);
    setQuality("review");
    setSelectedCoach("");
    setOfflineMessage("");
    setCameraError("");
    setPatientError("");
    setSubmittedCaseId("");
    setPlanSaved(false);
    setStage("habits");
  };
  const geminiObservationContent = () => {
    if (!imageUploaded) return <>{t("geminiPending")}</>;
    if (!geminiObservation) return <>{t("geminiUnavailable")}</>;
    if (geminiObservation.status !== "completed") {
      if (geminiObservation.status === "consent_required") return <>{t("geminiConsentRequired")} {user?.role === "patient" && <Link className="underline" to="/patient-dashboard#patient-module-11">{t("geminiManageConsent")}</Link>}</>;
      if (geminiObservation.status === "provider_unavailable") return <>{t("geminiProviderUnavailable")}</>;
      return <>{t("geminiUnavailable")}</>;
    }
    return <>
      <strong>{t("geminiTitle")} ({t("geminiQuality")}: {t(geminiObservation.imageQuality)}):</strong> {geminiObservation.visibleDescription}
      <span className="mt-1 block text-xs">{geminiObservation.model}</span>
      <span className="mt-1 block text-xs">{t("geminiDisclaimer")}</span>
    </>;
  };

  return <><SimulationBanner /><main className="case-flow">
    <header className="case-header"><div><p className="eyebrow">Aarogya Drishti</p><h1>{t("title")}</h1></div><Link className="secondary" to={user?.role === "patient" ? "/patient-dashboard" : "/doctor"}>{t("close")}</Link></header>
    {patientLoading && <p role="status">{t("loading")}</p>}
    {user?.role === "patient" && consentRequired && <section className="case-panel" role="status">
      <p>{t("consentRequired")}</p>
      <Link className="primary" to="/patient/screening">{t("reviewConsent")}</Link>
    </section>}
    {patientError && <p className="emergency-inline" role="alert">{patientError}</p>}
    <div hidden={user?.role === "patient" && consentRequired}>
    <div className="case-steps" aria-label="Case progress">{[["habits", t("habits")], ["symptoms", t("symptoms")], ["camera", t("camera")], ["summary", t("summary")], ["coach", t("coach")]].map(([key, label], index) => <span className={stage === key ? "current" : ""} key={key}>{index + 1}. {label}</span>)}</div>
    {stage === "habits" && <section className="case-panel"><h2>{t("habits")}</h2><p>{t("tobacco")}</p><div className="choice-grid">{[["none", t("none")], ["daily", t("daily")], ["sometimes", t("sometimes")]].map(([key, label]) => <button className={`choice ${habit === key ? "choice-active" : ""}`} onClick={() => setHabit(key)} key={key} type="button" aria-pressed={habit === key}>{label}</button>)}</div><p>{t("alcohol")}</p><div className="choice-grid">{[["none", t("none")], ["sometimes", t("sometimes")]].map(([key, label]) => <button className={`choice ${alcohol === key ? "choice-active" : ""}`} onClick={() => setAlcohol(key)} key={key} type="button" aria-pressed={alcohol === key}>{label}</button>)}</div><button className="primary" type="button" onClick={() => setStage("symptoms")}>{t("next")}</button></section>}
    {stage === "symptoms" && <section className="case-panel"><h2>{t("symptoms")}</h2><div className="choice-grid">{[["cough", t("cough")], ["mouth", t("mouth")], ["swallow", t("swallow")], ["voice", t("voice")], ["weight", t("weight")]].map(([key, label]) => <button className={`choice ${symptoms.includes(key) ? "choice-active" : ""}`} onClick={() => toggleSymptom(key)} key={key} type="button" aria-pressed={symptoms.includes(key)}>{label}</button>)}</div>{redFlag && <div className="emergency-inline" role="alert">{t("redFlag")} <button type="button" onClick={() => setStage("emergency")}>{t("callOfficer")}</button></div>}<div className="actions"><button className="secondary" type="button" onClick={() => setStage("habits")}>{t("back")}</button><button className="primary" type="button" onClick={() => setStage("camera")}>{t("next")}</button></div></section>}
    {stage === "emergency" && <section className="case-panel emergency" role="alert"><h2>{t("emergencyTitle")}</h2><p>{t("emergencyText")}</p><div className="emergency-actions"><a className="primary" href="tel:108">{t("call108")}</a><a className="secondary" href="tel:18001801203">{t("callOfficer")}</a></div><button className="secondary" type="button" onClick={() => setStage("camera")}>{t("next")}</button></section>}
    {stage === "camera" && <section className="case-panel">
      <h2>{t("camera")}</h2>
      <label>{t("site")}<select className="field" value={site} onChange={(event) => setSite(event.target.value)}>
        {["tongue", "gums", "innerCheek", "lips", "palate", "floorOfMouth", "otherOralArea"].map((area) => <option value={area} key={area}>{t(area)}</option>)}
      </select></label>
      <div className="camera-box">{streaming ? <video ref={videoRef} autoPlay playsInline muted aria-label={t("camera")} /> : <p>{t("coaching")}</p>}</div>
      {cameraError && <p className="emergency-inline" role="alert">{cameraError}</p>}
      <p className="light-meter"><strong>{t("light")}:</strong> <span className={streaming ? "light-good" : ""}>{streaming ? t("goodLight") : t("moreLight")}</span></p>
      {!streaming && <button className="primary" type="button" onClick={() => void startCamera()}>{t("camera")}</button>}
      {streaming && <button className="primary" type="button" onClick={capture}>{t("capture")}</button>}
      <label className="file-button secondary">{t("chooseFile")}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 9 * 1024 * 1024) {
          setCameraError(t("imageInvalid"));
          event.target.value = "";
          return;
        }
        setCameraError("");
        stopCamera();
        setImage(URL.createObjectURL(file));
        setImageUploaded(false);
        setGeminiObservation(undefined);
        setQuality("review");
        setStage("preview");
        void assessImageQuality(file);
      }} /></label>
      <div className="actions"><button className="secondary" type="button" onClick={() => { stopCamera(); setStage("symptoms"); }}>{t("back")}</button></div>
    </section>}
    {stage === "preview" && <section className="case-panel">
      <h2>{t("preview")}</h2>
      {image && <img className="case-preview" src={image} alt={`${t("site")} ${t(site)}`} />}
      <p><strong>{t("quality")}:</strong> {checkingQuality ? t("qualityChecking") : quality === "acceptable" ? t("acceptable") : t("review")}</p>
      <p className="light-meter" role="status">{t("geminiPending")}</p>
      <div className="ai-chips"><span>{t("ai")}</span><b className="chip chip-gray">{t("notAssessed")}</b><b className="chip chip-amber">{t("pending")}</b><b className="chip chip-blue">{t("reviewed")}</b></div>
      <div className="actions"><button className="secondary" type="button" onClick={() => setStage("camera")}>{t("recapture")}</button><button className="primary" type="button" onClick={() => setStage("summary")}>{t("next")}</button></div>
    </section>}
    {stage === "summary" && <section className="case-panel">
      <h2>{t("summary")}</h2>
      {user?.role !== "patient" && <label>Patient record ID / రోగి ID / रोगी ID<input className="field" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="Select or enter assigned patient ID" /></label>}
      <dl className="summary-details">
        <div><dt>{t("summaryHabits")}</dt><dd>{habit === "none" && alcohol === "none" ? t("noHabits") : [habit !== "none" ? `${t("tobacco")}: ${t(habit)}` : "", alcohol !== "none" ? `${t("alcohol")}: ${t(alcohol)}` : ""].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("summarySymptoms")}</dt><dd>{symptoms.length ? symptoms.map((symptom) => t(symptom)).join(" · ") : t("noSymptoms")}</dd></div>
        <div><dt>{t("summaryImage")}</dt><dd>{image ? `${t(imageUploaded ? "imageUploaded" : "imageReady")} · ${t(quality)}` : t("imageMissing")}</dd></div>
      </dl>
      {image && <p className="light-meter" role="status">{geminiObservationContent()}</p>}
      <div className="risk-band"><strong>{t("reviewStatus")}</strong><span>{submittedCaseId ? t("submittedRecord") : t("notSubmitted")}</span></div>
      <p>{t("noScore")}</p>
      {(symptoms.length > 0 || habit !== "none" || alcohol !== "none") && <><h3>{t("reasons")}</h3><ul>
        {symptoms.length > 0 && <li>{t("reason1")}</li>}
        {(habit !== "none" || alcohol !== "none") && <li>{t("reason2")}</li>}
      </ul></>}
      {submittedCaseId && <p className="saved-note">{t("submittedRecord")}: {submittedCaseId}</p>}
      {submittedCaseId && <button className="secondary" type="button" disabled={reportSaving} onClick={() => void downloadReport()}>{reportSaving ? t("submitting") : t("downloadReport")}</button>}
      {submittedCaseId && <p className="text-sm text-slate-600">{t("reportRiskNotAssessed")}</p>}
      <div className="actions">
        <button className="secondary" type="button" disabled={saving || (user?.role === "patient" && !patientReady)} onClick={() => void save()}>{saving ? t("saving") : t("save")}</button>
        <button className="primary" type="button" disabled={saving || (user?.role === "patient" && !patientReady)} onClick={() => void submit()}>{saving ? t(user?.role === "patient" && navigator.onLine ? "onlineSave" : "submitting") : t("submit")}</button>
      </div>
      <p className="saved-note" role="status">{offlineMessage || (localStorage.getItem(`aarogya-case-draft-${localStorage.getItem("aarogya-offline-owner-id") ?? ""}`) ? t("saved") : "")}</p>
      <button className="secondary" type="button" onClick={() => setStage("coach")}>{t("coach")}</button>
    </section>}
    {stage === "coach" && <section className="case-panel">
      <h2>{t("coach")}</h2><p>{t("coachText")}</p>
      <div className="coach-list">{[t("coach1"), t("coach2"), t("coach3")].map((item) => <button className={`choice ${selectedCoach === item ? "choice-active" : ""}`} type="button" key={item} aria-pressed={selectedCoach === item} onClick={() => { setSelectedCoach(item); setPlanSaved(false); }}>{item}</button>)}</div>
      {user?.role === "patient" && <button className="secondary" type="button" disabled={planSaving || planSaved || !navigator.onLine} onClick={() => void saveCessationPlan()}>{planSaving ? t("saving") : planSaved ? t("planSaved") : t("savePlan")}</button>}
      {planSaved && <p className="saved-note" role="status">{t("planSaved")}</p>}
      {!navigator.onLine && user?.role === "patient" && <p role="status">{t("planSaveError")}</p>}
      <button className="primary" type="button" onClick={beginNewCase}>{t("start")}</button>
    </section>}
    </div>
  </main></>;
}
