import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiMessage } from "../auth/api";
import { createHospitalManager, getHospitalManagers, getHospitals, resetHospitalManagerPassword, setHospitalManagerStatus, type Hospital, type HospitalManager } from "./adminApi";

const managerCopy = {
  en: { title: "Hospital managers", intro: "Manager access is limited to one assigned hospital. Share setup links out-of-band; they are shown only once.", provision: "Create manager account", name: "Full name", username: "Manager username", email: "Email", phone: "Phone (optional)", hospital: "Assigned active hospital", create: "Create manager", managers: "Current managers", search: "Search managers", noManagers: "No hospital managers found.", load: "Loading managers…", active: "Active", disabled: "Disabled", enable: "Activate", disable: "Deactivate", mfa: "MFA", enabled: "Enabled", notEnabled: "Not enrolled", reset: "Issue password setup link", setupLink: "One-time password setup link", expires: "Expires", copy: "Copy link", copied: "Link copied. Deliver it securely to the manager.", noHospitals: "Create an active hospital before provisioning a manager.", error: "Hospital manager administration failed." },
  te: { title: "ఆసుపత్రి నిర్వాహకులు", intro: "నిర్వాహకుడి ప్రవేశం ఒకే కేటాయించిన ఆసుపత్రికి పరిమితం. సెటప్ లింక్‌ను సురక్షితంగా వేరే మార్గంలో పంపండి; అది ఒక్కసారి మాత్రమే చూపబడుతుంది.", provision: "నిర్వాహక ఖాతా సృష్టించండి", name: "పూర్తి పేరు", username: "నిర్వాహక వినియోగదారు పేరు", email: "ఇమెయిల్", phone: "ఫోన్ (ఐచ్ఛికం)", hospital: "కేటాయించిన క్రియాశీల ఆసుపత్రి", create: "నిర్వాహకుడిని సృష్టించండి", managers: "ప్రస్తుత నిర్వాహకులు", search: "నిర్వాహకులను వెతకండి", noManagers: "ఆసుపత్రి నిర్వాహకులు కనబడలేదు.", load: "నిర్వాహకులను లోడ్ చేస్తోంది…", active: "క్రియాశీలం", disabled: "నిలిపివేయబడింది", enable: "క్రియాశీలం చేయండి", disable: "నిలిపివేయండి", mfa: "MFA", enabled: "ప్రారంభించబడింది", notEnabled: "ఇంకా నమోదు కాలేదు", reset: "పాస్‌వర్డ్ సెటప్ లింక్ ఇవ్వండి", setupLink: "ఒక్కసారి మాత్రమే ఉపయోగించే సెటప్ లింక్", expires: "గడువు", copy: "లింక్ కాపీ చేయండి", copied: "లింక్ కాపీ అయింది. నిర్వాహకుడికి సురక్షితంగా పంపండి.", noHospitals: "నిర్వాహకుడిని సృష్టించడానికి ముందుగా క్రియాశీల ఆసుపత్రిని సృష్టించండి.", error: "నిర్వాహకుల నిర్వహణ విఫలమైంది." },
  hi: { title: "अस्पताल प्रबंधक", intro: "प्रबंधक की पहुंच केवल एक निर्धारित अस्पताल तक सीमित है। सेटअप लिंक सुरक्षित माध्यम से साझा करें; यह केवल एक बार दिखता है।", provision: "प्रबंधक खाता बनाएँ", name: "पूरा नाम", username: "प्रबंधक उपयोगकर्ता नाम", email: "ईमेल", phone: "फ़ोन (वैकल्पिक)", hospital: "निर्धारित सक्रिय अस्पताल", create: "प्रबंधक बनाएँ", managers: "वर्तमान प्रबंधक", search: "प्रबंधक खोजें", noManagers: "कोई अस्पताल प्रबंधक नहीं मिला।", load: "प्रबंधक लोड हो रहे हैं…", active: "सक्रिय", disabled: "निष्क्रिय", enable: "सक्रिय करें", disable: "निष्क्रिय करें", mfa: "MFA", enabled: "सक्रिय", notEnabled: "नामांकित नहीं", reset: "पासवर्ड सेटअप लिंक जारी करें", setupLink: "एक बार का पासवर्ड सेटअप लिंक", expires: "समाप्ति", copy: "लिंक कॉपी करें", copied: "लिंक कॉपी हुआ। इसे प्रबंधक को सुरक्षित रूप से भेजें।", noHospitals: "प्रबंधक बनाने से पहले सक्रिय अस्पताल बनाएँ।", error: "अस्पताल प्रबंधक प्रबंधन विफल हुआ।" }
} as const;

export default function HospitalManagerAdmin() {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
  const copy = managerCopy[language as keyof typeof managerCopy] ?? managerCopy.en;
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [managers, setManagers] = useState<HospitalManager[]>([]);
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyManager, setBusyManager] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setupLink, setSetupLink] = useState("");
  const [form, setForm] = useState({ hospitalId: "", name: "", username: "", email: "", phone: "" });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([getHospitals(), getHospitalManagers(search)]).then(([nextHospitals, nextManagers]) => {
      if (!active) return;
      setHospitals(nextHospitals);
      setManagers(nextManagers);
    }).catch((requestError: unknown) => {
      if (active) setError(getApiMessage(requestError, copy.error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, refreshKey, copy.error]);

  function displaySetupLink(token: string) {
    const url = new URL("/hospital-manager/setup", window.location.origin);
    url.hash = new URLSearchParams({ token }).toString();
    setSetupLink(url.toString());
    setNotice("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await createHospitalManager(form);
      displaySetupLink(result.setupToken);
      setForm({ hospitalId: "", name: "", username: "", email: "", phone: "" });
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, copy.error));
    } finally {
      setBusy(false);
    }
  }

  async function managerAction(manager: HospitalManager, action: "status" | "reset") {
    setBusyManager(manager._id);
    setError("");
    setNotice("");
    try {
      if (action === "status") {
        await setHospitalManagerStatus(manager._id, manager.status === "active" ? "disabled" : "active");
        setRefreshKey((key) => key + 1);
      } else {
        const result = await resetHospitalManagerPassword(manager._id);
        displaySetupLink(result.setupToken);
      }
    } catch (requestError) {
      setError(getApiMessage(requestError, copy.error));
    } finally {
      setBusyManager("");
    }
  }

  async function copySetupLink() {
    try {
      await navigator.clipboard.writeText(setupLink);
      setNotice(copy.copied);
    } catch {
      setError(copy.error);
    }
  }

  return <section className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
    <div className="space-y-5">
      <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void submit(event)}>
        <h2 className="text-xl font-bold">{copy.provision}</h2>
        <p className="text-sm text-slate-600">{copy.intro}</p>
        <label className="block font-semibold">{copy.hospital}<select className="mt-1 min-h-touch w-full rounded-lg border px-3" required value={form.hospitalId} onChange={(event) => setForm({ ...form, hospitalId: event.target.value })}><option value="">{copy.hospital}</option>{hospitals.filter((hospital) => hospital.active && hospital.code).map((hospital) => <option key={hospital._id} value={hospital._id}>{hospital.name} ({hospital.code})</option>)}</select></label>
        {hospitals.filter((hospital) => hospital.active && hospital.code).length === 0 && <p className="text-sm text-amber-800">{copy.noHospitals}</p>}
        <label className="block font-semibold">{copy.name}<input className="mt-1 w-full rounded-lg border p-3" autoComplete="name" minLength={2} maxLength={100} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="block font-semibold">{copy.username}<input className="mt-1 w-full rounded-lg border p-3" autoComplete="username" minLength={3} maxLength={50} required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label className="block font-semibold">{copy.email}<input className="mt-1 w-full rounded-lg border p-3" type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="block font-semibold">{copy.phone}<input className="mt-1 w-full rounded-lg border p-3" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <button className="min-h-touch w-full rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="submit" disabled={busy || hospitals.every((hospital) => !hospital.active || !hospital.code)}>{busy ? copy.load : copy.create}</button>
      </form>
      {setupLink && <aside className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h3 className="font-bold">{copy.setupLink}</h3>
        <input aria-label={copy.setupLink} className="w-full rounded-lg border bg-white p-3 text-sm" readOnly value={setupLink} onFocus={(event) => event.currentTarget.select()} />
        <p className="text-sm">{copy.expires}: 24 hours</p>
        <button className="min-h-touch rounded-lg border border-amber-700 px-4 font-semibold" type="button" onClick={() => void copySetupLink()}>{copy.copy}</button>
        {notice && <p role="status">{notice}</p>}
      </aside>}
    </div>
    <div>
      <label className="mb-3 block font-semibold">{copy.search}<input className="mt-1 w-full rounded-lg border p-3" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <section className="space-y-3" aria-label={copy.managers}>
        <h2 className="text-xl font-bold">{copy.managers}</h2>
        {loading && <p role="status" className="rounded-xl bg-white p-4">{copy.load}</p>}
        {!loading && managers.length === 0 && <p className="rounded-xl bg-white p-4 text-slate-600">{copy.noManagers}</p>}
        {managers.map((manager) => {
          const hospital = typeof manager.hospitalId === "string" ? undefined : manager.hospitalId;
          return <article className="space-y-2 rounded-xl bg-white p-4 shadow-sm" key={manager._id}>
            <h3 className="font-bold">{manager.name} · {manager.username}</h3>
            <p className="text-sm text-slate-600">{manager.email}{manager.phone ? ` · ${manager.phone}` : ""}</p>
            <p className="text-sm text-slate-600">{hospital?.name ?? copy.hospital}{hospital?.code ? ` (${hospital.code})` : ""} · {manager.status === "active" ? copy.active : copy.disabled} · {copy.mfa}: {manager.mfaEnabled ? copy.enabled : copy.notEnabled}</p>
            <div className="flex flex-wrap gap-2">
              <button className="min-h-touch rounded-lg border px-3 font-semibold" type="button" disabled={busyManager === manager._id} onClick={() => void managerAction(manager, "status")}>{manager.status === "active" ? copy.disable : copy.enable}</button>
              <button className="min-h-touch rounded-lg border px-3 font-semibold" type="button" disabled={busyManager === manager._id || manager.status !== "active"} onClick={() => void managerAction(manager, "reset")}>{copy.reset}</button>
            </div>
          </article>;
        })}
      </section>
    </div>
    {error && <p className="rounded-lg bg-red-50 p-3 text-red-800 lg:col-span-2" role="alert">{error}</p>}
  </section>;
}
