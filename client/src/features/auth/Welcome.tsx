import { Navigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "./AuthProvider";

export default function Welcome() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) return <main className="p-8" role="status">{t("phase6.loading")}</main>;
  if (user) {
    const destination = user.role === "patient" ? "/patient-dashboard"
      : user.role === "doctor" ? "/doctor"
      : user.role === "hospital_manager" ? "/hospital-manager"
      : user.role === "asha_worker" ? "/asha"
      : "/admin/dashboard";
    return <Navigate to={destination} replace />;
  }

  return <div className="min-h-screen bg-medical-50">
    <SimulationBanner />
    <main className="mx-auto max-w-4xl px-4 pb-12 pt-16">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="mt-2 text-3xl font-bold">{t("phase6.welcomeTitle")}</h1></div>
        <LanguageSwitcher />
      </header>
      <p className="mb-8 max-w-2xl text-lg text-slate-700">{t("phase6.welcomeDescription")}</p>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">{t("phase6.patient")}</h2>
          <p className="mt-2 text-slate-600">{t("phase6.patientWelcome")}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link className="primary min-h-touch text-center" to="/patient/login">{t("phase6.patientLogin")}</Link>
            <Link className="min-h-touch rounded-xl border border-medical-700 px-4 py-3 text-center font-bold text-medical-900" to="/patient/register">{t("phase6.patientRegister")}</Link>
          </div>
        </section>
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">{t("phase6.doctor")}</h2>
          <p className="mt-2 text-slate-600">{t("phase6.doctorWelcome")}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link className="primary min-h-touch text-center" to="/doctor/login">{t("phase6.doctorLogin")}</Link>
            <Link className="min-h-touch rounded-xl border border-medical-700 px-4 py-3 text-center font-bold text-medical-900" to="/doctor/register">{t("phase6.doctorRegister")}</Link>
          </div>
        </section>
      </div>
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-600">
        <Link className="underline" to="/login?role=asha_worker">ASHA worker sign in</Link>
        <Link className="underline" to="/login?role=system_admin">{t("phase6.authorizedAccess")}</Link>
        <span>{t("phase6.notForClinicalUse")}</span>
      </footer>
    </main>
  </div>;
}
