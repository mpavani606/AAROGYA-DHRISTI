import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { getPatientProfile } from "./patientApi";

export default function PatientScreening() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function begin(event: React.FormEvent) {
    event.preventDefault();
    if (!consent || !user) return;
    setBusy(true);
    setError("");
    try {
      const patient = await getPatientProfile();
      await api.post(`/patients/${patient.id}/consents`, { purpose: "screening", granted: true, consentVersion: "simulation-screening-v1" });
      navigate("/patient/cases");
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase6.screeningConsentError")));
    } finally {
      setBusy(false);
    }
  }

  return <div className="min-h-screen bg-medical-50">
    <SimulationBanner />
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-20">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{t("phase6.screeningTitle")}</h1></div>
        <LanguageSwitcher />
      </header>
      <form className="space-y-5 rounded-2xl bg-white p-6 shadow-sm" onSubmit={(event) => void begin(event)}>
        <p className="text-slate-700">{t("phase6.screeningConsentDescription")}</p>
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">{t("phase6.notForClinicalUse")}</p>
        <label className="flex items-start gap-3 rounded-xl border p-4">
          <input className="mt-1" type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>{t("phase6.screeningConsent")}</span>
        </label>
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <button className="primary min-h-touch" type="submit" disabled={busy || !consent}>{busy ? t("phase6.saving") : t("phase6.continueScreening")}</button>
          <button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => navigate("/patient-dashboard")}>{t("phase6.cancel")}</button>
        </div>
      </form>
    </main>
  </div>;
}
