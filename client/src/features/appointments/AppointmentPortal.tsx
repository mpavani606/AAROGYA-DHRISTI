import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SimulationBanner } from "../../components/SimulationBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import api, { apiBaseUrl, getApiMessage } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { enqueueOperation } from "../../offline/db";

type Appointment = { _id: string; type: "video" | "physical"; startAt: string; status: string; tokenNo?: string; hospital?: { name?: string; address?: string } };
type Doctor = { _id: string; name: string; hospitalId: string; hospitalName: string; specialty: string; synthetic?: boolean };
type HospitalOption = { _id: string; name: string; synthetic?: boolean };
type DoctorSlot = { id: string; availabilityId: string; start: string; end: string };
type DirectorySource = { name: string; document?: string; snapshotDate?: string; url?: string; verifiedOn?: string; importedAt: string };
type DirectoryDoctor = {
  _id: string;
  name: string;
  hospitalId: string | DirectoryFacility;
  role: string;
  specialization?: string | null;
  registrationNumber?: string | null;
  hprId?: string | null;
  mobile?: string | null;
  email?: string | null;
  district: string;
  mandal: string;
  source: DirectorySource;
};
type DirectoryFacility = {
  _id: string;
  name: string;
  facilityType: string;
  hospitalCode?: string | null;
  district: string;
  mandal: string;
  address?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  beds?: number | null;
  sourceSerial?: number | null;
  source: DirectorySource;
  doctors: DirectoryDoctor[];
};
type DirectoryResponse = {
  facilities: DirectoryFacility[];
  doctors: DirectoryDoctor[];
  pagination: {
    facilities: { page: number; pageSize: number; totalRecords: number; totalPages: number };
    doctors: { page: number; pageSize: number; totalRecords: number; totalPages: number };
  };
  statistics: { facilities: number; doctors: number };
  filters: { districts: string[]; mandals: string[]; facilityTypes: string[]; specializations: string[] };
};

const formatDirectoryPhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    const local = digits.slice(2);
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return value;
};
const directoryPhoneHref = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `tel:+${digits}`;
  if (digits.length === 10) return `tel:+91${digits}`;
  return undefined;
};
const displayOrUnavailable = (value?: string | number | null) => value === undefined || value === null || value === "" ? "Not Available" : String(value);
const sourceNameLabel = (source: DirectorySource) => source.document ? `${source.name} (${source.document})` : source.name;
const sourceDateLabel = (source: DirectorySource) => source.snapshotDate
  ? `Source snapshot: ${source.snapshotDate}`
  : source.verifiedOn ? `Source checked: ${source.verifiedOn}` : "Source date: Not Available";
const importedDateLabel = (source: DirectorySource) => `Imported: ${new Date(source.importedAt).toLocaleDateString()}`;

export default function AppointmentPortal() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [directorySearch, setDirectorySearch] = useState("");
  const [debouncedDirectorySearch, setDebouncedDirectorySearch] = useState("");
  const [directoryData, setDirectoryData] = useState<DirectoryResponse>();
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const [selectedFacilityDetail, setSelectedFacilityDetail] = useState<DirectoryFacility>();
  const [directoryDistrict, setDirectoryDistrict] = useState("");
  const [directoryMandal, setDirectoryMandal] = useState("");
  const [directoryType, setDirectoryType] = useState("");
  const [directorySpecialization, setDirectorySpecialization] = useState("");
  const [facilityPage, setFacilityPage] = useState(1);
  const [directoryDoctorPage, setDirectoryDoctorPage] = useState(1);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [directoryRetryVersion, setDirectoryRetryVersion] = useState(0);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [hospitalId, setHospitalId] = useState("");
  const [clinicianId, setClinicianId] = useState("");
  const [doctorSlots, setDoctorSlots] = useState<DoctorSlot[]>([]);
  const [availabilityId, setAvailabilityId] = useState("");
  const [appointmentType, setAppointmentType] = useState<"physical" | "video">("physical");
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [joiningVideo, setJoiningVideo] = useState("");
  const [appointmentAction, setAppointmentAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selectedDirectoryFacility = selectedFacilityDetail?._id === selectedFacilityId
    ? selectedFacilityDetail
    : directoryData?.facilities.find((facility) => facility._id === selectedFacilityId);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedDirectorySearch(directorySearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [directorySearch]);

  useEffect(() => {
    let active = true;
    setDirectoryLoading(true);
    setDirectoryError("");
    void api.get<DirectoryResponse>("/facility-directory", {
      params: {
        q: debouncedDirectorySearch || undefined,
        district: directoryDistrict || undefined,
        mandal: directoryMandal || undefined,
        type: directoryType || undefined,
        specialization: directorySpecialization || undefined,
        facilityPage,
        doctorPage: directoryDoctorPage,
        limit: 10
      }
    }).then(({ data }) => {
      if (!active) return;
      setDirectoryData(data);
      setSelectedFacilityId((current) => data.facilities.some((facility) => facility._id === current)
        ? current
        : data.facilities[0]?._id ?? "");
    }).catch((requestError: unknown) => {
      if (active) setDirectoryError(getApiMessage(requestError, "Unable to load the hospital and doctor directory."));
    }).finally(() => {
      if (active) setDirectoryLoading(false);
    });
    return () => { active = false; };
  }, [debouncedDirectorySearch, directoryDistrict, directoryMandal, directoryType, directorySpecialization, facilityPage, directoryDoctorPage, directoryRetryVersion]);

  useEffect(() => {
    if (!selectedFacilityId) {
      setSelectedFacilityDetail(undefined);
      return;
    }
    let active = true;
    void api.get<{ facility: DirectoryFacility }>(`/facility-directory/${encodeURIComponent(selectedFacilityId)}`)
      .then(({ data }) => { if (active) setSelectedFacilityDetail(data.facility); })
      .catch((requestError: unknown) => { if (active) setDirectoryError(getApiMessage(requestError, "Unable to load facility details.")); });
    return () => { active = false; };
  }, [selectedFacilityId, directoryRetryVersion]);

  const updateDirectoryFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setFacilityPage(1);
    setDirectoryDoctorPage(1);
  };

  const loadAppointments = useCallback(async () => {
    const { data } = await api.get<{ appointments: Appointment[] }>("/appointments");
    setAppointments(data.appointments ?? []);
  }, []);
  const loadDoctorSlots = useCallback(async (doctorId: string) => {
    if (!doctorId) {
      setDoctorSlots([]);
      setAvailabilityId("");
      return;
    }
    const { data } = await api.get<{ slots: DoctorSlot[] }>(`/doctors/${doctorId}/slots`);
    setDoctorSlots(data.slots ?? []);
    setAvailabilityId("");
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const { data } = await api.get<{ appointments: Appointment[] }>("/appointments");
        if (active) setAppointments(data.appointments ?? []);
        if (user?.role === "patient") {
          const doctorResponse = await api.get<{ hospitals: HospitalOption[]; doctors: Doctor[] }>("/doctors/available");
          if (active) {
            setDoctors(doctorResponse.data.doctors);
            setHospitals(doctorResponse.data.hospitals);
            const firstHospital = doctorResponse.data.hospitals[0]?._id ?? "";
            setHospitalId(firstHospital);
            setClinicianId(doctorResponse.data.doctors.find((doctor) => doctor.hospitalId === firstHospital)?._id ?? "");
          }
        }
      } catch (requestError) {
        if (active) setError(getApiMessage(requestError, "Unable to load appointments or booking options."));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (user?.role !== "patient" || !clinicianId) return;
    let active = true;
    setError("");
    void api.get<{ slots: DoctorSlot[] }>(`/doctors/${clinicianId}/slots`)
      .then(({ data }) => {
        if (!active) return;
        setDoctorSlots(data.slots ?? []);
        setAvailabilityId("");
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiMessage(requestError, "Unable to load this doctor's schedule."));
      });
    return () => { active = false; };
  }, [clinicianId, user?.role]);

  const createAppointment = async (event: FormEvent) => {
    event.preventDefault();
    const selectedSlot = doctorSlots.find((slot) => slot.id === availabilityId);
    if (!clinicianId || !selectedSlot) return;
    setBooking(true); setError(""); setMessage("");
    const clientUuid = crypto.randomUUID();
    const request = {
      clientUuid,
      clinicianId,
      hospitalId,
      type: appointmentType,
      availabilityId: selectedSlot.availabilityId,
      startAt: selectedSlot.start,
      endAt: selectedSlot.end
    };
    try {
      if (!navigator.onLine) {
        await enqueueOperation("create_appointment_request", request, clientUuid);
        setMessage("Saved securely on this device. The slot will be rechecked when online; this is not yet a booked appointment.");
        return;
      }
      await api.post("/appointments/me", request);
      await loadAppointments();
      await loadDoctorSlots(clinicianId);
      setMessage("Appointment request sent. Your care team can confirm it.");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to request this appointment. Choose another time and try again."));
    } finally { setBooking(false); }
  };
  const hospitalDoctors = doctors.filter((doctor) => doctor.hospitalId === hospitalId);

  const directions = async (id: string) => {
    try {
      const { data } = await api.get(`/appointments/${id}/directions`);
      window.open(data.deepLink, "_blank", "noopener,noreferrer");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Directions unavailable."));
    }
  };

  const joinVideoConsultation = async (appointmentId: string) => {
    const callWindow = window.open("about:blank", "_blank");
    if (!callWindow) {
      setError("Allow pop-ups for this site to join the video consultation.");
      return;
    }
    callWindow.opener = null;
    setJoiningVideo(appointmentId);
    setError("");
    try {
      const { data: room } = await api.post<{ session: { _id: string } }>("/video/rooms", { appointmentId });
      const { data: meeting } = await api.get<{ token: string; roomUrl: string; provider: string }>(`/video/rooms/${room.session._id}/token`);
      if (meeting.provider !== "daily") throw new Error("The configured video provider is unavailable.");
      const url = new URL(meeting.roomUrl);
      url.searchParams.set("t", meeting.token);
      callWindow.location.assign(url.toString());
    } catch (requestError) {
      callWindow.close();
      setError(getApiMessage(requestError, "Unable to join the video consultation."));
    } finally {
      setJoiningVideo("");
    }
  };

  const confirmAppointment = async (appointmentId: string) => {
    setAppointmentAction(appointmentId);
    setError("");
    setMessage("");
    try {
      await api.post(`/appointments/${appointmentId}/confirm`);
      await loadAppointments();
      setMessage("Appointment confirmed. The patient can now join if it is a video appointment.");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to confirm this appointment."));
    } finally {
      setAppointmentAction("");
    }
  };

  const recordAttendance = async (appointmentId: string, status: "attended" | "missed" | "assessment_completed") => {
    setAppointmentAction(appointmentId);
    setError("");
    setMessage("");
    try {
      await api.post(`/appointments/${appointmentId}/attendance`, { status });
      await loadAppointments();
      setMessage(status === "missed" ? "Appointment marked as missed." : status === "attended" ? "Attendance recorded." : "Assessment marked complete.");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to update appointment attendance."));
    } finally {
      setAppointmentAction("");
    }
  };

  const cancelAppointment = async (appointmentId: string) => {
    setAppointmentAction(appointmentId);
    setError("");
    setMessage("");
    try {
      await api.patch(`/appointments/${appointmentId}`, { status: "cancelled" });
      await loadAppointments();
      setMessage("Appointment cancelled.");
    } catch (requestError) {
      setError(getApiMessage(requestError, "Unable to cancel this appointment."));
    } finally {
      setAppointmentAction("");
    }
  };

  return <><SimulationBanner /><main className="mx-auto max-w-7xl px-4 pb-10 pt-24">
    <header className="flex items-center justify-between gap-4">
      <div><Link to={user?.role === "patient" ? "/patient-dashboard" : "/"} className="font-bold text-medical-800">← Dashboard</Link><p className="mt-3 text-sm font-bold uppercase text-medical-700">Aarogya Drishti</p><h1 className="text-3xl font-bold">Appointments / అపాయింట్‌మెంట్లు / अपॉइंटमेंट</h1></div>
      <LanguageSwitcher />
    </header>
    {error && <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-800" role="alert">{error}</p>}
    {message && <p className="mt-4 rounded-xl bg-green-50 p-4 text-green-800" role="status">{message}</p>}

    <section id="hospital-directory" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="hospital-directory-title">
      <header className="mb-4">
        <h2 id="hospital-directory-title" className="text-xl font-bold">{t("phase11.hospitalDirectory")}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {directoryData ? `${directoryData.statistics.facilities} facilities · ${directoryData.statistics.doctors} Medical Officer listings` : t("loading")}
        </p>
      </header>
      <div className="mb-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-semibold" htmlFor="hospital-directory-search">{t("phase11.searchDirectory")}
          <input id="hospital-directory-search" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 p-3 font-[400]" type="search" value={directorySearch} onChange={(event) => { setDirectorySearch(event.target.value); setFacilityPage(1); setDirectoryDoctorPage(1); }} />
        </label>
        <label className="text-sm font-semibold">District
          <select className="mt-1 min-h-11 w-full rounded-lg border p-3 font-[400]" value={directoryDistrict} onChange={(event) => updateDirectoryFilter(setDirectoryDistrict, event.target.value)}>
            <option value="">All districts</option>{directoryData?.filters.districts.map((district) => <option key={district}>{district}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Mandal
          <select className="mt-1 min-h-11 w-full rounded-lg border p-3 font-[400]" value={directoryMandal} onChange={(event) => updateDirectoryFilter(setDirectoryMandal, event.target.value)}>
            <option value="">All mandals</option>{directoryData?.filters.mandals.map((mandal) => <option key={mandal}>{mandal}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Facility type
          <select className="mt-1 min-h-11 w-full rounded-lg border p-3 font-[400]" value={directoryType} onChange={(event) => updateDirectoryFilter(setDirectoryType, event.target.value)}>
            <option value="">All facility types</option>{directoryData?.filters.facilityTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Specialization
          <select className="mt-1 min-h-11 w-full rounded-lg border p-3 font-[400]" value={directorySpecialization} onChange={(event) => updateDirectoryFilter(setDirectorySpecialization, event.target.value)}>
            <option value="">All specializations</option><option value="Not Available">Not Available</option>{directoryData?.filters.specializations.map((specialization) => <option key={specialization}>{specialization}</option>)}
          </select>
        </label>
      </div>
      {directoryError && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{directoryError}<button type="button" className="ml-2 font-semibold underline" onClick={() => setDirectoryRetryVersion((current) => current + 1)}>Retry</button></p>}
      {directoryLoading ? <p className="py-8 text-center text-slate-600" role="status">Loading hospital and doctor records…</p> : !directoryError && (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.9fr)]">
            <section aria-labelledby="facility-results-title">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 id="facility-results-title" className="text-lg font-bold">Hospitals and PHCs ({directoryData?.pagination.facilities.totalRecords ?? 0})</h3>
                <span className="text-sm text-slate-600">Page {directoryData?.pagination.facilities.page ?? 1} of {Math.max(directoryData?.pagination.facilities.totalPages ?? 0, 1)}</span>
              </div>
              {(directoryData?.facilities.length ?? 0) === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-slate-700">{t("phase11.noDirectoryResults")}</p> : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {directoryData?.facilities.map((facility) => (
                    <button className={`rounded-xl border p-4 text-left transition ${selectedFacilityId === facility._id ? "border-medical-700 bg-medical-50 ring-1 ring-medical-700" : "border-slate-200 hover:border-medical-500 hover:bg-slate-50"}`} type="button" key={facility._id} aria-pressed={selectedFacilityId === facility._id} onClick={() => setSelectedFacilityId(facility._id)}>
                      <span className="block font-bold text-slate-900">{facility.name}</span>
                      <span className="mt-1 block text-sm text-slate-600">{facility.facilityType} · {facility.mandal}</span>
                      <span className="mt-1 block text-xs text-slate-500">{facility.doctors.length} listed Medical Officer(s)</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-4 flex justify-between gap-2">
                <button className="min-h-10 rounded-lg border px-4 font-semibold disabled:opacity-50" type="button" disabled={(directoryData?.pagination.facilities.page ?? 1) <= 1} onClick={() => setFacilityPage((current) => current - 1)}>Previous facilities</button>
                <button className="min-h-10 rounded-lg border px-4 font-semibold disabled:opacity-50" type="button" disabled={(directoryData?.pagination.facilities.page ?? 1) >= (directoryData?.pagination.facilities.totalPages ?? 0)} onClick={() => setFacilityPage((current) => current + 1)}>Next facilities</button>
              </div>
            </section>
            <article id="hospital-directory-details" className="rounded-xl border border-medical-100 bg-medical-50/60 p-4" aria-live="polite">
              {selectedDirectoryFacility ? <>
                <p className="text-xs font-bold uppercase tracking-wide text-medical-800">Hospital / PHC details</p>
                <h3 className="mt-1 text-xl font-bold text-slate-900">{selectedDirectoryFacility.name}</h3>
                <dl className="mt-4 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="font-semibold text-slate-600">Facility type</dt><dd>{selectedDirectoryFacility.facilityType}</dd>
                  <dt className="font-semibold text-slate-600">Hospital code</dt><dd className="break-all">{displayOrUnavailable(selectedDirectoryFacility.hospitalCode)}</dd>
                  <dt className="font-semibold text-slate-600">District</dt><dd>{displayOrUnavailable(selectedDirectoryFacility.district)}</dd>
                  <dt className="font-semibold text-slate-600">Mandal</dt><dd>{displayOrUnavailable(selectedDirectoryFacility.mandal)}</dd>
                  <dt className="font-semibold text-slate-600">Address</dt><dd>{displayOrUnavailable(selectedDirectoryFacility.address)}</dd>
                  <dt className="font-semibold text-slate-600">Contact number</dt><dd>{displayOrUnavailable(selectedDirectoryFacility.contactNumber)}</dd>
                  <dt className="font-semibold text-slate-600">Email address</dt><dd>{displayOrUnavailable(selectedDirectoryFacility.email)}</dd>
                  <dt className="font-semibold text-slate-600">HPR ID</dt><dd>{displayOrUnavailable(null)}</dd>
                  {selectedDirectoryFacility.beds !== null && selectedDirectoryFacility.beds !== undefined && <><dt className="font-semibold text-slate-600">Beds (source listing)</dt><dd>{selectedDirectoryFacility.beds}</dd></>}
                  {selectedDirectoryFacility.sourceSerial !== null && selectedDirectoryFacility.sourceSerial !== undefined && <><dt className="font-semibold text-slate-600">PDF source row</dt><dd>{selectedDirectoryFacility.sourceSerial}</dd></>}
                </dl>
                <div className="mt-4 border-t border-medical-100 pt-3">
                  <h4 className="font-bold">Associated doctors / Medical Officers</h4>
                  {selectedDirectoryFacility.doctors.length === 0 ? <p className="mt-2 text-sm text-slate-600">Not Available in the listed source.</p> : selectedDirectoryFacility.doctors.map((doctor) => (
                    <div className="mt-3 rounded-lg border border-medical-100 bg-white p-3" key={doctor._id}>
                      <p className="font-semibold">{doctor.name}</p>
                      <p className="text-sm text-slate-600">{doctor.role}</p>
                      <dl className="mt-2 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-2 gap-y-1 text-sm">
                        <dt>Specialization</dt><dd>{displayOrUnavailable(doctor.specialization)}</dd>
                        <dt>Registration no.</dt><dd>{displayOrUnavailable(doctor.registrationNumber)}</dd>
                        <dt>HPR ID</dt><dd>{displayOrUnavailable(doctor.hprId)}</dd>
                        <dt>Mobile</dt><dd>{directoryPhoneHref(doctor.mobile ?? "") ? <a className="underline" href={directoryPhoneHref(doctor.mobile ?? "")}>{formatDirectoryPhone(doctor.mobile ?? "")}</a> : displayOrUnavailable(doctor.mobile)}</dd>
                        <dt>Email</dt><dd>{doctor.email ? <a className="break-all underline" href={`mailto:${doctor.email}`}>{doctor.email}</a> : "Not Available"}</dd>
                      </dl>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-600">{sourceNameLabel(selectedDirectoryFacility.source)} · {sourceDateLabel(selectedDirectoryFacility.source)} · {importedDateLabel(selectedDirectoryFacility.source)}</p>
              </> : <p className="text-slate-700">{t("phase11.selectFacility")}</p>}
            </article>
          </div>
          <section id="doctor-speciality-directory" className="mt-8 border-t pt-6" aria-labelledby="doctor-directory-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="doctor-directory-title" className="text-xl font-bold">Doctor and Speciality</h3>
              <p className="text-sm text-slate-600">{directoryData?.pagination.doctors.totalRecords ?? 0} matching records</p>
            </div>
            {!directoryData?.doctors.length ? <p className="mt-3 rounded-xl bg-slate-50 p-4 text-slate-700">No Medical Officer records match these filters.</p> : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {directoryData.doctors.map((doctor) => {
                  const facility = typeof doctor.hospitalId === "object" ? doctor.hospitalId : undefined;
                  return <article className="rounded-xl border bg-white p-4" key={doctor._id}>
                    <h4 className="font-bold">{doctor.name}</h4>
                    <p className="text-sm text-slate-600">{doctor.role}</p>
                    <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-2 gap-y-1 text-sm">
                      <dt>Hospital / PHC</dt><dd>{facility?.name ?? "Not Available"}</dd>
                      <dt>Specialization</dt><dd>{displayOrUnavailable(doctor.specialization)}</dd>
                      <dt>Medical registration no.</dt><dd>{displayOrUnavailable(doctor.registrationNumber)}</dd>
                      <dt>HPR ID</dt><dd>{displayOrUnavailable(doctor.hprId)}</dd>
                      <dt>Mobile number</dt><dd>{directoryPhoneHref(doctor.mobile ?? "") ? <a className="underline" href={directoryPhoneHref(doctor.mobile ?? "")}>{formatDirectoryPhone(doctor.mobile ?? "")}</a> : displayOrUnavailable(doctor.mobile)}</dd>
                      <dt>Email address</dt><dd>{doctor.email ? <a className="break-all underline" href={`mailto:${doctor.email}`}>{doctor.email}</a> : "Not Available"}</dd>
                      <dt>District</dt><dd>{displayOrUnavailable(doctor.district)}</dd>
                      <dt>Mandal</dt><dd>{displayOrUnavailable(doctor.mandal)}</dd>
                    </dl>
                    {facility && <button className="mt-3 font-semibold text-medical-800 underline" type="button" onClick={() => { setSelectedFacilityId(facility._id); document.getElementById("hospital-directory-details")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>View listed hospital</button>}
                    <p className="mt-3 text-xs text-slate-500">{sourceNameLabel(doctor.source)} · {sourceDateLabel(doctor.source)} · {importedDateLabel(doctor.source)}</p>
                  </article>;
                })}
              </div>
            )}
            <div className="mt-4 flex justify-between gap-2">
              <button className="min-h-10 rounded-lg border px-4 font-semibold disabled:opacity-50" type="button" disabled={(directoryData?.pagination.doctors.page ?? 1) <= 1} onClick={() => setDirectoryDoctorPage((current) => current - 1)}>Previous doctors</button>
              <button className="min-h-10 rounded-lg border px-4 font-semibold disabled:opacity-50" type="button" disabled={(directoryData?.pagination.doctors.page ?? 1) >= (directoryData?.pagination.doctors.totalPages ?? 0)} onClick={() => setDirectoryDoctorPage((current) => current + 1)}>Next doctors</button>
            </div>
          </section>
        </>
      )}
      <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="note">{t("phase11.directoryDisclaimer")}</p>
    </section>

    {user?.role === "patient" && <form className="mt-6 grid gap-4 rounded-2xl bg-white p-5 shadow-sm" onSubmit={(event) => void createAppointment(event)}>
      <h2 className="text-xl font-bold">Request an appointment</h2>
      <p className="text-sm text-slate-600">{t("phase11.bookingScheduleNote")}</p>
      {doctors.length ? <>
        <label className="font-semibold">Hospital<select className="mt-1 w-full rounded-lg border p-3" required value={hospitalId} onChange={(event) => { const nextHospital = event.target.value; setHospitalId(nextHospital); setClinicianId(doctors.find((doctor) => doctor.hospitalId === nextHospital)?._id ?? ""); }}>{hospitals.map((hospital) => <option key={hospital._id} value={hospital._id}>{hospital.name}{hospital.synthetic ? " (Demo only)" : ""}</option>)}</select></label>
        <label className="font-semibold">Doctor and speciality<select className="mt-1 w-full rounded-lg border p-3" required value={clinicianId} onChange={(event) => setClinicianId(event.target.value)}>{hospitalDoctors.map((doctor) => <option key={doctor._id} value={doctor._id}>{doctor.name}{doctor.synthetic ? " (Demo clinician)" : ""} · {doctor.specialty}</option>)}</select></label>
        {hospitals.some((hospital) => hospital.synthetic) && <p className="rounded-xl bg-amber-50 p-4 text-amber-900" role="note">Demo facilities and clinicians are fictional and are not available for real care. Do not travel to or rely on these entries.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="font-semibold">Appointment type<select className="mt-1 w-full rounded-lg border p-3" value={appointmentType} onChange={(event) => setAppointmentType(event.target.value as "physical" | "video")}><option value="physical">In person</option><option value="video">Video</option></select></label>
        <label className="font-semibold">Available consultation schedule<select className="mt-1 w-full rounded-lg border p-3" required value={availabilityId} onChange={(event) => setAvailabilityId(event.target.value)}><option value="">Select a day and time</option>{doctorSlots.map((slot) => <option key={slot.id} value={slot.id}>{new Date(slot.start).toLocaleDateString([], { weekday: "long", year: "numeric", month: "short", day: "numeric" })} · {new Date(slot.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–{new Date(slot.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</option>)}</select></label>
        </div>
        <p className="text-sm text-slate-600">Available days and consultation timings are based on the doctor's scheduled working hours. Choosing a time reserves that schedule while the care team reviews your request.</p>
        <button className="min-h-touch w-full rounded-xl bg-medical-700 px-5 font-bold text-white disabled:opacity-60" type="submit" disabled={booking || loading || !clinicianId}>{booking ? "Sending request…" : "Request appointment"}</button>
      </> : <p className="rounded-xl bg-medical-50 p-4 text-slate-700">No active doctors are available to book right now. Please contact your care team.</p>}
      {doctors.length > 0 && doctorSlots.length === 0 && <p className="rounded-xl bg-medical-50 p-4 text-slate-700">No available working hours are scheduled for this doctor. Choose another doctor or contact the hospital.</p>}
    </form>}

    <section id="appointments" className="mt-8 grid gap-4" aria-label="Your appointments">
      <h2 className="text-xl font-bold">Your appointments</h2>
      {loading && <p role="status">{t("loading")}</p>}
      {appointments.map((item) => <article key={item._id} className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">{new Date(item.startAt).toLocaleString()}</h3><span className="rounded-full border px-3 py-1 font-bold">{item.status}</span></div>
        <p className="mt-2">{item.type} · Token {item.tokenNo ?? "—"}{item.hospital?.name ? ` · ${item.hospital.name}` : ""}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {user?.role === "doctor" && item.status === "requested" && <button className="min-h-touch rounded-xl bg-medical-700 px-4 font-bold text-white disabled:opacity-60" type="button" disabled={appointmentAction === item._id} onClick={() => void confirmAppointment(item._id)}>{appointmentAction === item._id ? "Updating…" : "Confirm appointment"}</button>}
          {user?.role === "doctor" && ["confirmed", "rescheduled"].includes(item.status) && <>
            <button className="min-h-touch rounded-xl border px-4 font-bold disabled:opacity-60" type="button" disabled={Boolean(appointmentAction)} onClick={() => void recordAttendance(item._id, "attended")}>Mark attended</button>
            <button className="min-h-touch rounded-xl border px-4 font-bold disabled:opacity-60" type="button" disabled={Boolean(appointmentAction)} onClick={() => void recordAttendance(item._id, "missed")}>Mark missed</button>
            <button className="min-h-touch rounded-xl border border-red-300 px-4 font-bold text-red-800 disabled:opacity-60" type="button" disabled={Boolean(appointmentAction)} onClick={() => void cancelAppointment(item._id)}>Cancel</button>
          </>}
          {item.type === "video" && <button className="min-h-touch rounded-xl bg-medical-700 px-4 font-bold text-white disabled:opacity-60" type="button" disabled={item.status !== "confirmed" || joiningVideo === item._id} onClick={() => void joinVideoConsultation(item._id)}>{joiningVideo === item._id ? "Connecting…" : item.status === "confirmed" ? "Join video consultation" : "Video call available after confirmation"}</button>}
          {user?.role === "doctor" && item.status === "attended" && <button className="min-h-touch rounded-xl border px-4 font-bold disabled:opacity-60" type="button" disabled={Boolean(appointmentAction)} onClick={() => void recordAttendance(item._id, "assessment_completed")}>Complete assessment</button>}
          <button className="min-h-touch rounded-xl border px-4 font-bold" type="button" onClick={() => void directions(item._id)}>Get directions / దారులు / दिशा</button>
          <a className="primary" href={`${apiBaseUrl}/appointments/${item._id}/slip`} target="_blank" rel="noreferrer">Slip / స్లిప్ / पर्ची</a>
        </div>
      </article>)}
      {!loading && appointments.length === 0 && <p className="rounded-2xl bg-white p-6">{t("no_appointments", "No appointments yet.")}</p>}
    </section>
  </main></>;
}
