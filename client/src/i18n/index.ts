import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import te from "./locales/te.json";
import hi from "./locales/hi.json";
import phase4 from "./phase4";
import phase5 from "./phase5";
import phase6 from "./phase6";
import phase7 from "./phase7";
import phase8 from "./phase8";
import phase10 from "./phase10";
import phase11 from "./phase11";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { ...en, phase4: phase4.en, phase5: phase5.en, phase6: phase6.en, phase7: phase7.en, phase8: phase8.en, phase10: phase10.en, phase11: phase11.en } },
    te: { translation: { ...te, phase4: phase4.te, phase5: phase5.te, phase6: phase6.te, phase7: phase7.te, phase8: phase8.te, phase10: phase10.te, phase11: phase11.te } },
    hi: { translation: { ...hi, phase4: phase4.hi, phase5: phase5.hi, phase6: phase6.hi, phase7: phase7.hi, phase8: phase8.hi, phase10: phase10.hi } }
  },
  lng: localStorage.getItem("aarogya-language") ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }
});

export default i18n;
