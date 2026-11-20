import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";
import { getApiMessage } from "../auth/api";
import {
  addManagerAvailability,
  getManagerDashboard,
  getManagerDoctors,
  getManagerHospital,
  getManagerMedicineInventory,
  getManagerNotifications,
  markManagerNotificationRead,
  removeManagerAvailability,
  saveManagerMedicineInventory,
  updateManagerHospital,
  type ManagerDoctor,
  type ManagerHospital,
  type ManagerMedicineInventory,
  type ManagerNotification
} from "./hospitalManagerApi";

export default function HospitalManagerDashboard() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [hospital, setHospital] = useState<ManagerHospital>();
  const [doctors, setDoctors] = useState<ManagerDoctor[]>([]);
  const [notifications, setNotifications] = useState<ManagerNotification[]>([]);
  const [inventory, setInventory] = useState<ManagerMedicineInventory[]>([]);
  const [medicineForm, setMedicineForm] = useState({ medicineName: "", quantity: "0", unit: "units" });
  const [counts, setCounts] = useState<{ doctors: number; activeDoctors: number; availableSlots: number; upcomingAppointments: number; completedAppointments: number }>();
  const [search, setSearch] = useState("");
  const [services, setServices] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [schedule, setSchedule] = useState({ doctorId: "", start: "", end: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([getManagerDashboard(), getManagerHospital(), getManagerDoctors(search), getManagerNotifications(), getManagerMedicineInventory()])
      .then(([dashboard, profile, roster, inbox, stock]) => {
        if (!active) return;
        setHospital(profile.hospital);
        setAddress(profile.hospital.address ?? "");
        setPhone(profile.hospital.phone ?? "");
        setServices(profile.hospital.services?.join(", ") ?? "");
        setCounts(dashboard.counts);
        setDoctors(roster.doctors);
        setNotifications(inbox);
        setInventory(stock);
      }).catch((requestError: unknown) => {
        if (active) setError(getApiMessage(requestError, t("phase4.loadError")));
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, refreshKey, t]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await updateManagerHospital({
        address: address.trim(),
        phone: phone.trim(),
        services: services.split(",").map((service) => service.trim()).filter(Boolean)
      });
      setNotice(t("phase4.saved"));
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase4.saveError")));
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule(event: React.FormEvent) {
    event.preventDefault();
    if (!schedule.doctorId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await addManagerAvailability(schedule.doctorId, new Date(schedule.start).toISOString(), new Date(schedule.end).toISOString());
      setNotice(t("phase4.scheduleSaved"));
      setSchedule({ doctorId: "", start: "", end: "" });
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase4.scheduleError")));
    } finally {
      setBusy(false);
    }
  }

  async function removeSchedule(doctorId: string, slotId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await removeManagerAvailability(doctorId, slotId);
      setNotice(t("phase4.scheduleRemoved"));
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase4.scheduleError")));
    } finally {
      setBusy(false);
    }
  }

  async function saveMedicine(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveManagerMedicineInventory({
        medicineName: medicineForm.medicineName.trim(),
        quantity: Number(medicineForm.quantity),
        unit: medicineForm.unit.trim()
      });
      setMedicineForm({ medicineName: "", quantity: "0", unit: "units" });
      setNotice(t("phase4.inventorySaved"));
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase4.inventoryError")));
    } finally {
      setBusy(false);
    }
  }

  async function markRead(notificationId: string) {
    setError("");
    try {
      await markManagerNotificationRead(notificationId);
      setNotifications((current) => current.map((item) => item._id === notificationId ? { ...item, status: "read" } : item));
    } catch (requestError) {
      setError(getApiMessage(requestError, t("phase4.notificationError")));
    }
  }

  return <>
    <SimulationBanner />
    <main className="mx-auto max-w-6xl space-y-6 px-4 pb-10 pt-24">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p>
          <h1 className="text-3xl font-bold">{t("phase4.managerDashboard")}</h1>
          <p className="text-slate-600">{hospital?.name} · {hospital?.code}</p>
        </div>
        <div className="flex gap-2">
          <LanguageSwitcher />
          <button className="min-h-touch rounded-lg border px-3" type="button" onClick={() => navigate("/analytics")}>{t("phase8.title")}</button>
          <button className="min-h-touch rounded-lg border px-3" type="button" onClick={async () => { await logout(); navigate("/login"); }}>{t("logout")}</button>
        </div>
      </header>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
      {notice && <p className="rounded-lg bg-green-50 p-3 text-green-900" role="status">{notice}</p>}
      {loading ? <p role="status">{t("phase4.loading")}</p> : <>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label={t("phase4.hospitalSummary")}>
          {[
            [t("phase4.doctors"), counts?.doctors ?? 0],
            [t("phase4.activeDoctors"), counts?.activeDoctors ?? 0],
            [t("phase4.availableSlots"), counts?.availableSlots ?? 0],
            [t("phase4.upcomingAppointments"), counts?.upcomingAppointments ?? 0],
            [t("phase4.completedAppointments"), counts?.completedAppointments ?? 0]
          ].map(([label, value]) => <article className="rounded-xl bg-white p-4 shadow-sm" key={label}>
            <p className="text-sm text-slate-600">{label}</p><p className="text-2xl font-bold">{value}</p>
          </article>)}
        </section>
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">{t("phase4.noPatientDetails")}</p>
        <div className="grid gap-6 lg:grid-cols-2">
          <form className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void saveProfile(event)}>
            <h2 className="text-xl font-bold">{t("phase4.hospitalProfile")}</h2>
            <p className="text-sm text-slate-600">{hospital?.type} · {hospital?.active ? t("phase4.active") : t("phase4.inactive")}</p>
            <label className="block font-semibold">{t("phase4.address")}<input className="mt-1 w-full rounded-lg border p-3" maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <label className="block font-semibold">{t("phase4.phone")}<input className="mt-1 w-full rounded-lg border p-3" maxLength={30} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label className="block font-semibold">{t("phase4.services")}<input className="mt-1 w-full rounded-lg border p-3" maxLength={2000} value={services} onChange={(event) => setServices(event.target.value)} /></label>
            <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" disabled={busy} type="submit">{busy ? t("phase4.saving") : t("phase4.save")}</button>
          </form>
          <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">{t("phase4.doctorRoster")}</h2>
            <label className="block font-semibold">{t("phase4.searchDoctors")}<input className="mt-1 w-full rounded-lg border p-3" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            {doctors.length === 0 ? <p className="text-slate-600">{t("phase4.noDoctors")}</p> : doctors.map((doctor) => <article className="rounded-xl border p-3" key={doctor.id}>
              <h3 className="font-bold">{doctor.name ?? doctor.username}</h3>
              <p className="text-sm text-slate-600">{doctor.specialty} · Account: {doctor.status} · Verification: {doctor.verificationStatus ?? "draft"}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {doctor.availability.map((slot) => <li className="flex flex-wrap items-center justify-between gap-2" key={slot.id}>
                  <span>{new Date(slot.start).toLocaleString()} — {new Date(slot.end).toLocaleTimeString()}</span>
                  {!slot.booked && <button className="rounded border px-2 py-1" disabled={busy} type="button" onClick={() => void removeSchedule(doctor.id, slot.id)}>{t("phase4.remove")}</button>}
                </li>)}
              </ul>
            </article>)}
          </section>
        </div>
        <form className="grid gap-3 rounded-2xl bg-white p-5 shadow-sm sm:grid-cols-4 sm:items-end" onSubmit={(event) => void saveSchedule(event)}>
          <h2 className="text-xl font-bold sm:col-span-4">{t("phase4.addAvailability")}</h2>
          <label className="block font-semibold">{t("phase4.doctor")}
            <select className="mt-1 w-full rounded-lg border p-3" required value={schedule.doctorId} onChange={(event) => setSchedule((current) => ({ ...current, doctorId: event.target.value }))}>
              <option value="">{t("phase4.selectDoctor")}</option>
              {doctors.filter((doctor) => doctor.status === "active" && (doctor.verificationStatus ?? "verified") === "verified").map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name ?? doctor.username}</option>)}
            </select>
          </label>
          <label className="block font-semibold">{t("phase4.starts")}<input className="mt-1 w-full rounded-lg border p-3" required type="datetime-local" value={schedule.start} onChange={(event) => setSchedule((current) => ({ ...current, start: event.target.value }))} /></label>
          <label className="block font-semibold">{t("phase4.ends")}<input className="mt-1 w-full rounded-lg border p-3" required type="datetime-local" min={schedule.start} value={schedule.end} onChange={(event) => setSchedule((current) => ({ ...current, end: event.target.value }))} /></label>
          <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" disabled={busy || !schedule.doctorId} type="submit">{busy ? t("phase4.saving") : t("phase4.add")}</button>
        </form>
        <section className="grid gap-4 rounded-2xl bg-white p-5 shadow-sm lg:grid-cols-2">
          <form className="space-y-3" onSubmit={(event) => void saveMedicine(event)}>
            <h2 className="text-xl font-bold">{t("phase4.medicineInventory")}</h2>
            <p className="text-sm text-slate-600">{t("phase4.inventoryDisclosure")}</p>
            <label className="block font-semibold">{t("phase4.medicineName")}<input className="mt-1 w-full rounded-lg border p-3" required maxLength={160} value={medicineForm.medicineName} onChange={(event) => setMedicineForm((current) => ({ ...current, medicineName: event.target.value }))} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block font-semibold">{t("phase4.stockQuantity")}<input className="mt-1 w-full rounded-lg border p-3" required type="number" min={0} max={1_000_000} value={medicineForm.quantity} onChange={(event) => setMedicineForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
              <label className="block font-semibold">{t("phase4.stockUnit")}<input className="mt-1 w-full rounded-lg border p-3" required maxLength={40} value={medicineForm.unit} onChange={(event) => setMedicineForm((current) => ({ ...current, unit: event.target.value }))} /></label>
            </div>
            <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" disabled={busy} type="submit">{busy ? t("phase4.saving") : t("phase4.saveStock")}</button>
          </form>
          <div className="space-y-2">
            <h3 className="text-lg font-bold">{t("phase4.currentStock")}</h3>
            {inventory.length ? inventory.map((item) => <article className="rounded-lg border p-3" key={item._id}>
              <p className="font-semibold">{item.medicineName} · {item.quantity} {item.unit}</p>
              <p className="text-xs text-slate-600">{t("phase4.stockUpdated")}: {new Date(item.updatedAt).toLocaleString()}</p>
            </article>) : <p className="text-slate-600">{t("phase4.noStockRecords")}</p>}
          </div>
        </section>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">{t("phase4.notifications")}</h2>
          {notifications.length === 0 ? <p className="mt-2 text-slate-600">{t("phase4.noNotifications")}</p> : <ul className="mt-3 space-y-2">{notifications.map((item) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={item._id}>
            <span>{item.template} · {item.channel} · {new Date(item.createdAt).toLocaleString()} · {item.status}</span>
            {item.status !== "read" && <button className="min-h-touch rounded border px-3" type="button" onClick={() => void markRead(item._id)}>{t("phase4.markRead")}</button>}
          </li>)}</ul>}
        </section>
      </>}
    </main>
  </>;
}
