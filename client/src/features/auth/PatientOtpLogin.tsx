import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "./api";
import { useAuth, type AuthUser } from "./AuthProvider";

export default function PatientOtpLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading: authLoading, setSession } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!authLoading && user?.role === "patient") {
      navigate("/patient-dashboard", { replace: true });
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "1") {
      setNotice(t("phase6.otpRegisteredNotice"));
    }
  }, [authLoading, navigate, t, user]);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice(""); setDevOtp("");
    try {
      const { data } = await api.post("/auth/patient/otp/request", { phone });
      setChallengeId(data.challengeId);
      if (data.devOtp && import.meta.env.DEV) {
        setDevOtp(data.devOtp);
        setNotice(t("phase6.developmentOtp"));
      } else {
        setNotice(t("phase6.otpNotice"));
      }
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase6.otpError")));
    } finally { setBusy(false); }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const { data } = await api.post<{ accessToken?: string; user?: AuthUser }>("/auth/patient/otp/verify", { challengeId, code });
      if (!data.accessToken || data.user?.role !== "patient") {
        throw new Error("The patient sign-in response was incomplete. Please try again.");
      }
      setSession(data.accessToken, data.user as AuthUser);
      navigate("/patient-dashboard", { replace: true });
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase6.otpError")));
    } finally { setBusy(false); }
  }

  if (authLoading) return <div className="p-8" role="status">Checking your patient session...</div>;

  return <div className="min-h-screen bg-medical-50">
    <SimulationBanner />
    <main className="mx-auto max-w-lg px-4 pb-10 pt-24">
      <header className="mb-6 flex items-center justify-between"><div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{t("phase6.patientLoginTitle")}</h1></div><LanguageSwitcher /></header>
      <form className="space-y-4 rounded-2xl bg-white p-6 shadow-sm" onSubmit={(event) => void (challengeId ? verifyCode(event) : requestCode(event))}>
        <label className="block font-semibold">{t("phase6.mobileNumber")}<input className="mt-1 w-full rounded-lg border p-3" autoComplete="tel" inputMode="tel" required value={phone} disabled={Boolean(challengeId)} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" /></label>
        {challengeId && <label className="block font-semibold">{t("phase6.otpCode")}<input className="mt-1 w-full rounded-lg border p-3" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} /></label>}
        {notice && <p className="rounded-lg bg-medical-50 p-3 text-slate-800" role="status">{notice}</p>}
        {devOtp && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{t("phase6.developmentOtp")} {devOtp}</p>}
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
        <button className="min-h-touch w-full rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" disabled={busy} type="submit">{busy ? t("phase6.pleaseWait") : challengeId ? t("phase6.verifyAndSignIn") : t("phase6.sendOtp")}</button>
        {challengeId && <button className="min-h-touch w-full rounded-xl border border-medical-700 px-5 font-bold text-medical-900" type="button" disabled={busy} onClick={() => { setChallengeId(""); setCode(""); setNotice(""); setError(""); setDevOtp(""); }}>{t("phase6.differentNumber")}</button>}
        <p className="text-center text-sm text-slate-600">
          {t("phase6.newPatient")} <Link className="font-bold text-medical-700 underline" to="/patient/register">{t("phase6.registerBeforeSignIn")}</Link>
        </p>
        <p className="text-center text-sm text-slate-600">{t("phase6.doctorLoginLink")}: <Link className="font-bold text-medical-700 underline" to="/doctor/login">{t("phase6.doctorLoginLink")}</Link>.</p>
      </form>
    </main>
  </div>;
}
