import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiMessage } from "../auth/api";
import { getDistricts, getMandals, saveHospital, type District, type Hospital, type Mandal } from "./adminApi";
import MapPicker from "./MapPicker";

const types = ["PHC", "CHC", "AreaHospital", "DistrictHospital", "Private", "DiagnosticCentre"];
export default function HospitalForm({ initial, onSaved }: { initial?: Hospital; onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Partial<Hospital>>(initial ?? { type: "PHC", active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [districts, setDistricts] = useState<District[]>([]);
  const [mandals, setMandals] = useState<Mandal[]>([]);
  useEffect(() => {
    let active = true;
    setForm(initial
      ? { ...initial, ownershipType: initial.ownershipType ?? (["private", "Private"].includes(initial.type) ? "private" : "government") }
      : { type: "PHC", ownershipType: "government", active: true });
    setError("");
    void getDistricts().then(async (availableDistricts) => {
      if (!active) return;
      setDistricts(availableDistricts);
      const currentDistrict = initial?.district
        ? String(initial.district)
        : availableDistricts.find((district) => /alluri|sitharama|asr/i.test(`${district.name} ${district.name_en ?? ""} ${district.code}`))?._id ?? "";
      if (!initial && currentDistrict) setForm((current) => ({ ...current, district: currentDistrict }));
      const availableMandals = await getMandals(currentDistrict || undefined);
      if (active) setMandals(availableMandals);
    }).catch((requestError: unknown) => {
      if (active) setError(getApiMessage(requestError, "Unable to load hospital locations."));
    });
    return () => { active = false; };
  }, [initial]);
  const update = (key: string, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));
  async function changeDistrict(value: string) {
    setForm((current) => ({ ...current, district: value, mandalId: "" }));
    try { setMandals(await getMandals(value || undefined)); }
    catch (requestError) { setError(getApiMessage(requestError, "Unable to load mandals for this district.")); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await saveHospital(form); onSaved(); }
    catch (requestError) { setError(getApiMessage(requestError, "Unable to save hospital.")); }
    finally { setBusy(false); }
  }
  return <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" onSubmit={submit}>
    <h2 className="text-xl font-bold">{initial ? t("phase4.editHospital") : t("phase4.addHospital")}</h2>
    <label className="block font-semibold">{t("phase4.hospitalName")}<input className="mt-1 w-full rounded-lg border p-3" required value={form.name ?? ""} onChange={(e) => update("name", e.target.value)} /></label>
    <label className="block font-semibold">{t("phase4.hospitalId")}<input className="mt-1 w-full rounded-lg border p-3" maxLength={50} required={!initial} value={form.code ?? ""} onChange={(e) => update("code", e.target.value.toUpperCase())} /></label>
    <label className="block font-semibold">Hospital category<select className="mt-1 w-full rounded-lg border p-3" value={form.type} onChange={(e) => update("type", e.target.value)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label className="block font-semibold">Hospital ownership<select className="mt-1 w-full rounded-lg border p-3" required value={form.ownershipType ?? "government"} onChange={(e) => update("ownershipType", e.target.value)}><option value="government">Government Hospital</option><option value="private">Private Hospital</option></select></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block font-semibold">District<select className="mt-1 w-full rounded-lg border p-3" value={form.district ?? ""} onChange={(e) => void changeDistrict(e.target.value)}><option value="">Select district</option>{districts.map((district) => <option key={district._id} value={district._id}>{district.name_en ?? district.name}</option>)}</select></label>
      <label className="block font-semibold">Mandal<select className="mt-1 w-full rounded-lg border p-3" value={form.mandalId ?? ""} onChange={(e) => update("mandalId", e.target.value)}><option value="">Select mandal</option>{mandals.map((mandal) => <option key={mandal._id} value={mandal._id}>{mandal.name_en ?? mandal.name}</option>)}</select></label>
    </div>
    <label className="block font-semibold">Address<input className="mt-1 w-full rounded-lg border p-3" value={form.address ?? ""} onChange={(e) => update("address", e.target.value)} /></label>
    <label className="block font-semibold">Phone<input className="mt-1 w-full rounded-lg border p-3" maxLength={30} type="tel" value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value)} /></label>
    <label className="block font-semibold">Services (comma separated)<input className="mt-1 w-full rounded-lg border p-3" value={(form.services ?? []).join(", ")} onChange={(e) => setForm((current) => ({ ...current, services: e.target.value.split(",").map((service) => service.trim()).filter(Boolean) }))} /></label>
    <MapPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm((current) => ({ ...current, lat, lng }))} />
    {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
    <div className="flex gap-2"><button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white" disabled={busy} type="submit">{busy ? "Saving..." : "Save hospital"}</button>{initial && <button className="min-h-touch rounded-xl border px-5" type="button" onClick={onSaved}>Cancel</button>}</div>
  </form>;
}
