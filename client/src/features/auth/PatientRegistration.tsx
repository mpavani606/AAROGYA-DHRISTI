import { useState } from "react";
import { AxiosError } from "axios";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "./api";
import { useAuth } from "./AuthProvider";

const initialForm = {
  name: "",
  phone: "",
  age: "",
  dateOfBirth: "",
  address: "",
  district: "",
  mandal: "",
  village: "",
  preferredLanguage: "en",
  consent: false,
};

export default function PatientRegistration() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [form, setForm] = useState({ ...initialForm, preferredLanguage: (i18n.resolvedLanguage ?? "en").split("-")[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const updateValue = (field: keyof typeof initialForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  if (loading) return <div className="p-8" role="status">Checking your patient session...</div>;
  if (user?.role === "patient") return <Navigate to="/patient-dashboard" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await api.post("/auth/patient/register", {
        name: form.name.trim(),
        phone: form.phone.trim(),
        age: Number(form.age),
        dateOfBirth: form.dateOfBirth || undefined,
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        district: form.district.trim(),
        mandal: form.mandal,
        village: form.village.trim(),
        preferredLanguage: form.preferredLanguage,
        consent: form.consent,
      });

      setSuccess(t("phase6.registrationSaved"));
      window.setTimeout(() => navigate("/patient/login?registered=1", { replace: true }), 400);
    } catch (requestError) {
      setError(requestError instanceof AxiosError && !requestError.response
        ? t("phase6.patientRegisterServiceUnavailable")
        : getApiMessage(requestError, t("phase6.patientRegisterError")));
    } finally {
      setBusy(false);
    }
  };

  return <div className="min-h-screen bg-medical-50">
    <SimulationBanner />
    <main className="mx-auto max-w-xl px-4 pb-10 pt-24">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">{t("phase6.patientRegisterTitle")}</h1>
        </div>
        <LanguageSwitcher />
      </header>

      <form className="space-y-4 rounded-2xl bg-white p-6 shadow-sm" onSubmit={(event) => void submit(event)}>
        <label className="block font-semibold">{t("phase6.fullName")}
          <input className="mt-1 w-full rounded-lg border p-3" required value={form.name} onChange={(event) => updateValue("name", event.target.value)} placeholder="Enter patient name" />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block font-semibold">{t("phase6.mobileNumber")}
            <input className="mt-1 w-full rounded-lg border p-3" autoComplete="tel" inputMode="tel" required value={form.phone} onChange={(event) => updateValue("phone", event.target.value)} placeholder="+91 98765 43210" />
          </label>

          <label className="block font-semibold">{t("phase6.age")}
            <input className="mt-1 w-full rounded-lg border p-3" type="number" inputMode="numeric" min={0} max={120} required value={form.age} onChange={(event) => updateValue("age", event.target.value)} />
          </label>
        </div>

        <label className="block font-semibold">{t("phase6.dateOfBirth")}
          <input className="mt-1 w-full rounded-lg border p-3" type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={(event) => updateValue("dateOfBirth", event.target.value)} />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block font-semibold">{t("phase6.district")}
            <input className="mt-1 w-full rounded-lg border p-3" required maxLength={100} value={form.district} onChange={(event) => updateValue("district", event.target.value)} />
          </label>
          <label className="block font-semibold">{t("phase6.mandal")}
            <input className="mt-1 w-full rounded-lg border p-3" required maxLength={100} value={form.mandal} onChange={(event) => updateValue("mandal", event.target.value)} />
          </label>
          <label className="block font-semibold">{t("phase6.village")}
            <input className="mt-1 w-full rounded-lg border p-3" required maxLength={100} value={form.village} onChange={(event) => updateValue("village", event.target.value)} />
          </label>
          <label className="block font-semibold">{t("phase6.address")}
            <input className="mt-1 w-full rounded-lg border p-3" maxLength={200} value={form.address} onChange={(event) => updateValue("address", event.target.value)} />
          </label>

          <label className="block font-semibold">{t("phase6.preferredLanguage")}
            <select className="mt-1 w-full rounded-lg border p-3" value={form.preferredLanguage} onChange={(event) => { updateValue("preferredLanguage", event.target.value); void i18n.changeLanguage(event.target.value); localStorage.setItem("aarogya-language", event.target.value); }}>
              <option value="en">English</option>
              <option value="te">Telugu</option>
              <option value="hi">Hindi</option>
            </select>
          </label>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
          <input className="mt-1" type="checkbox" checked={form.consent} onChange={(event) => updateValue("consent", event.target.checked)} required />
          <span>{t("phase6.registrationConsent")}</span>
        </label>

        {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
        {success && <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800" role="status">{success}</p>}

        <button className="min-h-touch w-full rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="submit" disabled={busy}>
          {busy ? t("phase6.registering") : t("phase6.registerPatient")}
        </button>

        <p className="text-center text-sm text-slate-600">
          {t("phase6.alreadyRegistered")} <Link className="font-bold text-medical-700 underline" to="/patient/login">{t("phase6.signInWithOtp")}</Link>
        </p>
      </form>
    </main>
  </div>;
}
