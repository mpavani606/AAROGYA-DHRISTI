import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import api, { getApiMessage } from "./api";
import { useAuth, type AuthUser, type UserRole } from "./AuthProvider";

const roles: { value: UserRole; label: string; icon: string }[] = [
  { value: "patient", label: "Patient", icon: "👤" },
  { value: "doctor", label: "Doctor", icon: "🩺" },
  { value: "hospital_manager", label: "Hospital manager", icon: "🏥" },
  { value: "district_admin", label: "District admin", icon: "📊" },
  { value: "system_admin", label: "System admin", icon: "⚙️" }
  ,{ value: "asha_worker", label: "ASHA worker", icon: "🧑‍⚕️" }
];
const mfaText = {
  en: { setup: "Scan or enter this secret in an authenticator app, then enter its current six-digit code.", verify: "Enter the current six-digit code from your authenticator app.", secret: "One-time setup secret", manager: "Hospital manager", hospitalId: "Hospital ID / code", managerUsername: "Manager username", passwordSetupComplete: "Password set. Sign in with your Hospital ID and manager username." },
  te: { setup: "ఈ రహస్య కోడ్‌ను ఆథెంటికేటర్ యాప్‌లో నమోదు చేసి, ప్రస్తుతం ఉన్న ఆరు అంకెల కోడ్‌ను నమోదు చేయండి.", verify: "ఆథెంటికేటర్ యాప్‌లోని ప్రస్తుత ఆరు అంకెల కోడ్‌ను నమోదు చేయండి.", secret: "ఒకసారి మాత్రమే చూపించే సెటప్ కోడ్", manager: "ఆసుపత్రి నిర్వాహకుడు", hospitalId: "ఆసుపత్రి ID / కోడ్", managerUsername: "నిర్వాహకుడి వినియోగదారు పేరు", passwordSetupComplete: "పాస్‌వర్డ్ సెట్ అయింది. మీ ఆసుపత్రి ID మరియు నిర్వాహక వినియోగదారు పేరుతో సైన్ ఇన్ చేయండి." },
  hi: { setup: "इस गुप्त कोड को ऑथेंटिकेटर ऐप में जोड़ें, फिर उसका वर्तमान छह अंकों का कोड दर्ज करें।", verify: "ऑथेंटिकेटर ऐप का वर्तमान छह अंकों का कोड दर्ज करें।", secret: "एक बार दिखने वाला सेटअप कोड", manager: "अस्पताल प्रबंधक", hospitalId: "अस्पताल ID / कोड", managerUsername: "प्रबंधक उपयोगकर्ता नाम", passwordSetupComplete: "पासवर्ड सेट हो गया। अपने अस्पताल ID और प्रबंधक उपयोगकर्ता नाम से साइन इन करें।" }
} as const;

async function generateDemoTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Invalid authenticator secret.");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (!bytes.length || !globalThis.crypto?.subtle) throw new Error("Secure code generation is unavailable.");

  const counter = Math.floor(Date.now() / 30_000);
  const counterBytes = new Uint8Array(8);
  const counterView = new DataView(counterBytes.buffer);
  counterView.setUint32(0, Math.floor(counter / 0x1_0000_0000));
  counterView.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]) >>> 0;
  return String(binary % 1_000_000).padStart(6, "0");
}

export default function Login() {
  const { t, i18n } = useTranslation();
  const { setSession } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const doctorLoginPage = location.pathname === "/doctor/login";
  const requestedRole = searchParams.get("role");
  const initialRole: UserRole = doctorLoginPage ? "doctor" : requestedRole === "doctor" || requestedRole === "hospital_manager" || requestedRole === "district_admin" || requestedRole === "system_admin" || requestedRole === "asha_worker" ? requestedRole : "patient";
  const [role, setRole] = useState<UserRole>(initialRole);
  const [identifier, setIdentifier] = useState("");
  const [hospitalCode, setHospitalCode] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [demoCodeError, setDemoCodeError] = useState("");
  const [demoCodeSecondsLeft, setDemoCodeSecondsLeft] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lang = (i18n.resolvedLanguage ?? i18n.language).split("-")[0] as keyof typeof mfaText;
  const mfaCopy = mfaText[lang] ?? mfaText.en;
  const identifierLabel = doctorLoginPage ? t("phase5.loginIdentifier") : role === "patient" ? t("phone") : role === "hospital_manager" ? mfaCopy.managerUsername : t("phase6.loginIdentifier");

  useEffect(() => {
    if (!import.meta.env.DEV || !setupSecret) {
      setDemoCode("");
      setDemoCodeError("");
      return;
    }
    let active = true;
    let currentCounter = -1;
    const updateDemoCode = () => {
      const now = Math.floor(Date.now() / 1000);
      const counter = Math.floor(now / 30);
      setDemoCodeSecondsLeft(30 - (now % 30));
      if (counter === currentCounter) return;
      currentCounter = counter;
      setDemoCodeError("");
      void generateDemoTotp(setupSecret).then((code) => {
        if (active) setDemoCode(code);
      }).catch(() => {
        if (active) {
          setDemoCode("");
          setDemoCodeError("Demo code generation is unavailable in this browser.");
        }
      });
    };
    updateDemoCode();
    const timer = window.setInterval(updateDemoCode, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [setupSecret]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const endpoint = requiresOtp ? "/auth/mfa/verify" : "/auth/login";
      const payload = requiresOtp ? { mfaToken, code: otp } : { identifier, password, role, ...(role === "hospital_manager" ? { hospitalCode } : {}) };
      const { data } = await api.post(endpoint, payload);
      if (data.mfaSetupRequired || data.mfaRequired || data.challenge) {
        setRequiresOtp(true);
        setMfaToken(data.mfaToken);
        if (data.mfaSetupRequired) {
          const setup = await api.post("/auth/mfa/setup", { mfaToken: data.mfaToken });
          setSetupSecret(setup.data.secret);
        }
        return;
      }
      const user = (data.user ?? data) as AuthUser;
      setSession(data.accessToken, user);
      navigate(user.role === "patient" ? "/patient" : user.role === "doctor" ? "/doctor" : user.role === "hospital_manager" ? "/hospital-manager" : user.role === "asha_worker" ? "/asha" : "/admin/dashboard", { replace: true });
    } catch (requestError) {
      setError(getApiMessage(requestError, t("login_failed")));
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-medical-50">
      <SimulationBanner />
      <main className="mx-auto max-w-lg px-4 pb-10 pt-24">
        <div className="mb-8 flex items-center justify-between"><div><p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">{t("phase6.loginPageTitle")}</h1></div><LanguageSwitcher /></div>
        {(location.state as { passwordSetupComplete?: boolean; doctorRegistrationComplete?: boolean } | null)?.passwordSetupComplete && <p className="mb-4 rounded-lg bg-green-50 p-3 text-green-900" role="status">{mfaCopy.passwordSetupComplete}</p>}
        {(location.state as { doctorRegistrationComplete?: boolean } | null)?.doctorRegistrationComplete && <p className="mb-4 rounded-lg bg-green-50 p-3 text-green-900" role="status">{t("phase5.registrationComplete")}</p>}
        {!doctorLoginPage && <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Role">
          {roles.map((item) => <button key={item.value} type="button" role="tab" aria-selected={role === item.value} className={`min-h-touch rounded-xl border p-3 font-bold ${role === item.value ? "border-medical-700 bg-medical-700 text-white" : "border-medical-100 bg-white"}`} onClick={() => { setRole(item.value); setRequiresOtp(false); setOtp(""); setSetupSecret(""); setMfaToken(""); }}>{item.icon} <span className="ml-1">{item.value === "patient" ? t("phase6.rolePatient") : item.value === "doctor" ? t("phase6.roleDoctor") : item.value === "hospital_manager" ? mfaCopy.manager : item.value === "district_admin" ? t("phase6.roleDistrictAdmin") : item.value === "system_admin" ? t("phase6.roleSystemAdmin") : "ASHA worker"}</span></button>)}
        </div>}
        <form aria-busy={busy} className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-sm" onSubmit={submit}>
          {role === "hospital_manager" && <label className="block font-semibold">{mfaCopy.hospitalId}<input className="mt-1 w-full rounded-lg border p-3" required autoComplete="organization" value={hospitalCode} onChange={(event) => setHospitalCode(event.target.value)} /></label>}
          <div>
            <label className="block font-semibold" htmlFor="login-identifier">{identifierLabel}</label>
            <input id="login-identifier" className="mt-1 w-full rounded-lg border p-3" required type="text" autoComplete="username" inputMode={doctorLoginPage ? "text" : role === "patient" ? "tel" : "text"} placeholder={doctorLoginPage ? t("phase5.loginIdentifierPlaceholder") : undefined} aria-describedby={doctorLoginPage ? "doctor-login-identifier-hint" : undefined} value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            {doctorLoginPage && <p id="doctor-login-identifier-hint" className="mt-1 text-sm font-medium text-slate-600">{t("phase5.loginIdentifierHint")}</p>}
          </div>
          {!requiresOtp ? <label className="block font-semibold">{t("password")}<span className="mt-1 flex rounded-lg border"><input className="w-full p-3 outline-none" required type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="px-3" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t("phase6.hidePassword") : t("phase6.showPassword")}>{showPassword ? "🙈" : "👁️"}</button></span></label> : <label className="block font-semibold">{t("otp")}<input className="mt-1 w-full rounded-lg border p-3" required inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>}
          {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
          <button className="min-h-touch w-full rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" disabled={busy} type="submit">{busy ? t("loading") : requiresOtp ? t("verify") : t("login")}</button>
          {requiresOtp && <div className="rounded-lg bg-medical-50 p-3 text-sm text-slate-800"><p>{setupSecret ? mfaCopy.setup : mfaCopy.verify}</p>{setupSecret && <p className="mt-2 break-all font-mono font-bold" aria-label={mfaCopy.secret}>{setupSecret}</p>}
            {import.meta.env.DEV && setupSecret && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3" aria-live="polite">
              <p className="font-semibold">Demo one-time code · development only</p>
              {demoCodeError ? <p className="mt-1 text-rose-800" role="alert">{demoCodeError}</p> : <p className="mt-1 font-mono text-lg font-bold tracking-widest">{demoCode || "Generating…"} <span className="font-sans text-xs font-medium">· refreshes in {demoCodeSecondsLeft}s</span></p>}
            </div>}
          </div>}
          {role === "patient" && !requiresOtp && <button className="min-h-touch w-full rounded-xl border border-medical-700 px-5 font-bold text-medical-900" type="button" onClick={() => navigate("/patient/login")}>{t("phase6.mobileOtpLogin")}</button>}
          {role === "doctor" && !requiresOtp && <button className="min-h-touch w-full rounded-xl border border-medical-700 px-5 font-bold text-medical-900" type="button" onClick={() => navigate("/doctor/register")}>{t("phase5.registerTitle")}</button>}
        </form>
      </main>
    </div>
  );
}
