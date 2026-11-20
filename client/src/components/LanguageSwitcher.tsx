import { useTranslation } from "react-i18next";

const languages = [
  { code: "te", label: "తెలుగు" },
  { code: "en", label: "EN" },
  { code: "hi", label: "हिंदी" }
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  return (
    <div className="flex gap-2" aria-label="Language">
      {languages.map((language) => (
        <button
          className="min-h-touch min-w-touch rounded-lg border border-medical-700 px-3 font-bold"
          key={language.code}
          type="button"
          aria-pressed={i18n.language === language.code}
          onClick={() => {
            void i18n.changeLanguage(language.code);
            localStorage.setItem("aarogya-language", language.code);
          }}
        >
          {language.label}
        </button>
      ))}
    </div>
  );
}
