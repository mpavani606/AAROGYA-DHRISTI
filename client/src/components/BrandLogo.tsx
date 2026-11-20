import { useTranslation } from "react-i18next";

const brandNames = {
  en: { first: "AAROGYA", second: "DRISHTI", label: "AAROGYA DRISHTI" },
  te: { first: "ఆరోగ్య", second: "దృష్టి", label: "ఆరోగ్య దృష్టి" },
  hi: { first: "आरोग्य", second: "दृष्टि", label: "आरोग्य दृष्टि" }
};

export function BrandLogo() {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().split("-")[0];
  const locale = language === "te" ? "te" : language === "hi" ? "hi" : "en";
  const name = brandNames[locale];

  return (
    <div className="brand-logo" role="img" aria-label={name.label}>
      <img src="/aarogya-drishti-logo.jpeg" alt="" />
      {locale !== "en" && (
        <span className="brand-logo-overlay" lang={locale}>
          <span className="brand-logo-first">{name.first}</span>
          <span className="brand-logo-second">{name.second}</span>
        </span>
      )}
    </div>
  );
}
