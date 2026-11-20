import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AxiosError } from "axios";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "../auth/api";

type Registration = {
  name: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  registrationNo: string;
  registrationAuthority: string;
  specialty: string;
  hospitalName: string;
  qualification: string;
  experienceYears: string;
};

const emptyRegistration: Registration = {
  name: "",
  username: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  registrationNo: "",
  registrationAuthority: "",
  specialty: "",
  hospitalName: "",
  qualification: "",
  experienceYears: ""
};

export default function DoctorRegistration() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyRegistration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (form.password !== form.confirmPassword) {
      setError(t("phase6.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        username: form.username,
        email: form.email,
        phone: form.phone,
        password: form.password,
        registrationNo: form.registrationNo,
        registrationAuthority: form.registrationAuthority,
        specialty: form.specialty,
        hospitalName: form.hospitalName,
        qualification: form.qualification,
        experienceYears: Number(form.experienceYears)
      };
      await api.post("/auth/doctor/register", payload);
      navigate("/doctor/login", { replace: true, state: { doctorRegistrationComplete: true } });
    } catch (requestError) {
      const body = requestError instanceof AxiosError
        ? requestError.response?.data as { error?: { code?: string; details?: { fieldErrors?: Record<string, string[] | undefined> } } } | undefined
        : undefined;
      const fieldErrors = body?.error?.code === "VALIDATION_ERROR" ? body.error.details?.fieldErrors : undefined;
      const validationMessages = Object.entries(fieldErrors ?? {}).flatMap(([key, messages]) =>
        (messages ?? []).map((message) => `${t(`phase5.${key}`)}: ${message}`)
      );
      setError(validationMessages.length
        ? validationMessages.join(" ")
        : getApiMessage(requestError, t("phase5.registrationUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Omit<Registration, "confirmPassword">, type = "text") => (
    <label className="block font-semibold" key={key}>
      {t(`phase5.${key}`)}
      <input
        autoComplete={key === "password" ? "new-password" : key}
        className="mt-1 min-h-touch w-full rounded-lg border p-3"
        maxLength={key === "name" ? 100 : key === "username" ? 50 : key === "email" ? 254 : key === "phone" ? 20 : key === "password" ? 128 : key === "registrationNo" ? 80 : key === "registrationAuthority" ? 160 : key === "specialty" ? 120 : key === "hospitalName" ? 160 : 200}
        minLength={key === "password" ? 12 : key === "username" ? 3 : key === "phone" ? 7 : undefined}
        pattern={key === "username" ? "[a-zA-Z0-9._-]+" : undefined}
        required
        type={type}
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? 70 : undefined}
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );

  return <><SimulationBanner /><main className="mx-auto max-w-2xl px-4 pb-10 pt-24">
    <header className="mb-6 flex items-center justify-between gap-3"><div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{t("phase5.registerTitle")}</h1></div><LanguageSwitcher /></header>
    <p className="mb-5 text-slate-700">{t("phase5.registerDescription")}</p>
    <p className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">{t("phase5.notForClinicalUse")}</p>
    {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
    <form aria-busy={busy} className="grid gap-4 rounded-2xl bg-white p-6 shadow-sm sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
      {field("name")}
      {field("username")}
      {field("email", "email")}
      {field("phone", "tel")}
      {field("registrationNo")}
      {field("registrationAuthority")}
      {field("specialty")}
      {field("hospitalName")}
      {field("qualification")}
      {field("experienceYears", "number")}
      {field("password", "password")}
      <label className="block font-semibold">{t("phase5.confirmPassword")}<input autoComplete="new-password" className="mt-1 min-h-touch w-full rounded-lg border p-3" maxLength={128} minLength={12} required type="password" value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
      <button aria-live="polite" className="primary min-h-touch sm:col-span-2" disabled={busy} type="submit">{busy ? t("phase6.creatingAccount") : t("phase5.registerTitle")}</button>
    </form>
    <p className="mt-5 text-center text-sm text-slate-700"><Link className="font-bold text-medical-700 underline" to="/doctor/login">{t("phase5.login")}</Link></p>
  </main></>;
}
