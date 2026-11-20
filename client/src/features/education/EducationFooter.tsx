import type { EducationPage } from "./educationApi";

const generalNote = {
  en: "General information. Follow your doctor's advice.",
  te: "సాధారణ సమాచారం. మీ వైద్యుడి సలహాను పాటించండి.",
  hi: "सामान्य जानकारी। अपने डॉक्टर की सलाह मानें।"
} as const;
const pending = {
  en: "Pending clinical review",
  te: "వైద్య సమీక్ష పెండింగ్‌లో ఉంది",
  hi: "चिकित्सकीय समीक्षा लंबित है"
} as const;

export function EducationFooter({ page, language }: { page?: EducationPage; language: "en" | "te" | "hi" }) {
  const reviewer = typeof page?.reviewedBy === "object" ? page.reviewedBy?.name : undefined;
  return (
    <footer className="mt-8 rounded-2xl border border-medical-200 bg-white p-5 text-sm">
      <p className="font-semibold">{generalNote[language]}</p>
      {page?.status === "published" && reviewer && page.reviewedAt
        ? <p className="mt-2 text-slate-700">{reviewer} · {new Date(page.reviewedAt).toLocaleDateString(language)}</p>
        : <p className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-950" role="status">{pending[language]}</p>}
      <p className="mt-2 text-xs text-slate-600">SIMULATION - NOT FOR CLINICAL USE</p>
    </footer>
  );
}
