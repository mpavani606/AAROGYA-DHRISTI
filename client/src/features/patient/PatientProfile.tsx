import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AxiosError } from "axios";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { SimulationBanner } from "../../components/SimulationBanner";
import { useAuth } from "../auth/AuthProvider";
import { getApiMessage } from "../auth/api";
import { getPatientProfile, getOwnPrescriptions, getPatientRecords, getRecordSignedUrl, uploadPatientRecord, type PatientProfile as Profile, type PatientRecord, type Prescription } from "./patientApi";
import { queuePatientRecord, readQueuedPatientRecords, syncPatientRecords, type OfflineRecord } from "./offline";

const recordTypes = ["Lab report", "Prescription", "Imaging", "Other"];
const ageFromDob = (date?: string) => date ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 31557600000)) : undefined;

export default function PatientProfile() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const patientId = profile?.id ?? "";
  const [records, setRecords] = useState<PatientRecord[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [queued, setQueued] = useState<OfflineRecord[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState({ title: "", type: recordTypes[0], recordDate: new Date().toISOString().slice(0, 10), sourceHospital: "", sourceHospitalType: undefined as "government" | "private" | undefined, sourceDoctor: "", notes: "" });
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const nextProfile = await getPatientProfile();
    const [nextRecords, nextPrescriptions] = await Promise.all([
      getPatientRecords(nextProfile.id),
      getOwnPrescriptions()
    ]);
    setProfile(nextProfile); setRecords(nextRecords); setPrescriptions(nextPrescriptions);
    try { setQueued(await readQueuedPatientRecords(nextProfile.id)); }
    catch (error) {
      setQueued([]);
      setMessage(error instanceof Error ? error.message : "Unlock your offline PIN to view queued records.");
    }
  }, [user?.id]);
  useEffect(() => { void refresh().catch((error: unknown) => setMessage(getApiMessage(error, "Unable to load your patient record."))); }, [refresh]);
  useEffect(() => {
    const handleUnlock = () => { void refresh().catch((error: unknown) => setMessage(getApiMessage(error, "Unable to load your patient record."))); };
    window.addEventListener("aarogya-pin-unlock", handleUnlock);
    return () => window.removeEventListener("aarogya-pin-unlock", handleUnlock);
  }, [refresh]);
  useEffect(() => {
    const loadUrls = async () => {
      try {
        const mediaIds = [...new Set(records.flatMap((record) => record.media))];
        const entries = await Promise.all(mediaIds.map(async (mediaId) => [mediaId, await getRecordSignedUrl(patientId, mediaId)] as const));
        setUrls(Object.fromEntries(entries));
      } catch (error) {
        setMessage(getApiMessage(error, "Unable to open uploaded medical records."));
      }
    };
    if (patientId) void loadUrls();
  }, [records, patientId]);
  useEffect(() => {
    const handleOnline = () => { if (patientId) void syncPatientRecords(patientId, refresh); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [patientId, refresh]);
  useEffect(() => {
    const video = cameraVideoRef.current;
    const stream = cameraStreamRef.current;
    if (!cameraOpen || !video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => setCameraError(t("phase6.cameraUnavailable")));
    return () => { video.srcObject = null; };
  }, [cameraOpen, t]);
  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const age = useMemo(() => ageFromDob(profile?.dateOfBirth), [profile?.dateOfBirth]);
  const chooseFile = (file?: File) => {
    if (file) {
      setSelected(file);
      setCameraError("");
    }
  };
  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = undefined;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setCameraOpen(false);
  };
  const startCamera = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t("phase6.cameraUnavailable"));
      return;
    }
    try {
      cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      setCameraOpen(true);
    } catch (error) {
      setCameraError(error instanceof DOMException && error.name === "NotAllowedError"
        ? t("phase6.cameraPermissionDenied")
        : t("phase6.cameraUnavailable"));
    }
  };
  const captureCameraPhoto = () => {
    const video = cameraVideoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setCameraError(t("phase6.cameraNotReady"));
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError(t("phase6.cameraCaptureFailed"));
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError(t("phase6.cameraCaptureFailed"));
        return;
      }
      setSelected(new File([blob], `health-record-${Date.now()}.jpg`, { type: "image/jpeg" }));
      setCameraError("");
      stopCamera();
    }, "image/jpeg", 0.82);
  };
  const submit = async () => {
    if (!selected || !form.title || !patientId) return;
    setUploading(true); setMessage("");
    try {
      if (!navigator.onLine) {
        await queuePatientRecord({ patientId, file: selected, fileName: selected.name, ...form });
        setMessage(t("saved_offline")); setSelected(null); setForm((v) => ({ ...v, title: "", sourceHospital: "", sourceHospitalType: undefined, sourceDoctor: "", notes: "" }));
      } else {
        await uploadPatientRecord(patientId, { file: selected, ...form });
        setMessage(t("synced")); setSelected(null); setForm((v) => ({ ...v, title: "", sourceHospital: "", sourceHospitalType: undefined, sourceDoctor: "", notes: "" })); await refresh();
      }
    } catch (requestError) {
      if (requestError instanceof AxiosError && !requestError.response) {
        await queuePatientRecord({ patientId, file: selected, fileName: selected.name, ...form });
        setMessage(t("saved_offline"));
      } else {
        setMessage(getApiMessage(requestError, "Unable to save medical record."));
      }
    } finally { setUploading(false); }
  };
  const retry = async () => { await syncPatientRecords(patientId, refresh); await refresh(); };
  const statusLabel: Record<OfflineRecord["status"], string> = { "saved-offline": t("saved_offline"), pending: t("pending_sync"), syncing: t("syncing"), synced: t("synced"), failed: t("failed") };

  return <><SimulationBanner /><main className="patient-profile">
    <header className="profile-header">
      <div><p className="eyebrow">Aarogya Drishti</p><h1>{t("patient_profile")}</h1><p>{t("profile_subtitle")}</p></div>
      <div className="profile-actions"><LanguageSwitcher /><button className="secondary" type="button" onClick={async () => { try { await logout(); } finally { window.location.assign("/patient/login"); } }}>{t("logout")}</button></div>
    </header>
    <section className="profile-grid">
      <article className="panel"><h2>{t("personal_details")}</h2><dl className="details">
        <dt>{t("name")}</dt><dd>{profile?.name ?? user?.name ?? "—"}</dd>
        <dt>{t("phone")}</dt><dd>{profile?.phone ?? user?.phone ?? "—"}</dd>
        <dt>{t("age")}</dt><dd>{age === undefined ? "—" : `${age} ${t("years")}`}</dd>
        <dt>{t("date_of_birth")}</dt><dd>{profile?.dateOfBirth ?? "—"}</dd>
        <dt>{t("address")}</dt><dd>{profile?.address ?? "—"}</dd>
      </dl></article>
      <article className="panel"><h2>{t("habits")}</h2><ul className="habit-list">{Object.entries({ tobacco: profile?.habits?.tobacco, alcohol: profile?.habits?.alcohol, exercise: profile?.habits?.exercise, diet: profile?.habits?.diet }).map(([key, value]) => <li key={key}><b>{t(key)}</b><span>{value || t("not_recorded")}</span></li>)}</ul></article>
    </section>
    <section className="panel uploader"><h2>{t("add_record")}</h2><div className={`drop-zone ${dragging ? "drop-active" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files[0]); }}>
      <p>{selected ? selected.name : t("drop_record")}</p><button className="primary" type="button" onClick={() => inputRef.current?.click()}>{t("choose_file")}</button><button className="secondary" type="button" onClick={() => void startCamera()}>{t("use_camera")}</button>
      <input ref={inputRef} hidden type="file" accept="image/*,application/pdf" onChange={(e) => { chooseFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      <input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => { const file = e.target.files?.[0]; chooseFile(file); e.currentTarget.value = ""; if (file) stopCamera(); }} />
    </div>
      {cameraError && <p className="notice" role="alert">{cameraError}</p>}
      {cameraError && <button className="secondary mt-3" type="button" onClick={() => cameraInputRef.current?.click()}>{t("phase6.useDeviceCamera")}</button>}
      {cameraOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
        <section className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-4 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="patient-camera-title">
          <div className="flex items-center justify-between gap-4"><h2 id="patient-camera-title" className="text-xl font-bold">{t("phase6.cameraTitle")}</h2><button className="secondary" type="button" onClick={stopCamera}>{t("phase6.closeCamera")}</button></div>
          <video ref={cameraVideoRef} className="max-h-[65vh] w-full rounded-lg bg-black object-contain" autoPlay playsInline muted aria-label={t("phase6.cameraTitle")} />
          {cameraError && <p className="notice" role="alert">{cameraError}</p>}
          <div className="flex flex-wrap gap-3">
            <button className="primary" type="button" onClick={captureCameraPhoto}>{t("phase6.capturePhoto")}</button>
            <button className="secondary" type="button" onClick={() => cameraInputRef.current?.click()}>{t("phase6.useDeviceCamera")}</button>
          </div>
        </section>
      </div>}
      <div className="form-grid"><label>{t("title")}<input className="field" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>{t("record_type")}<select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{recordTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>{t("record_date")}<input className="field" type="date" value={form.recordDate} onChange={(e) => setForm({ ...form, recordDate: e.target.value })} /></label><label>Hospital name<input className="field" maxLength={200} value={form.sourceHospital} onChange={(e) => setForm({ ...form, sourceHospital: e.target.value })} placeholder="Where was this report issued?" /></label><label>Hospital type<select className="field" value={form.sourceHospitalType ?? ""} onChange={(e) => setForm({ ...form, sourceHospitalType: e.target.value === "government" || e.target.value === "private" ? e.target.value : undefined })}><option value="">Select hospital type</option><option value="government">Government Hospital</option><option value="private">Private Hospital</option></select></label><label>Previous treating doctor's name<input className="field" maxLength={200} value={form.sourceDoctor} onChange={(e) => setForm({ ...form, sourceDoctor: e.target.value })} /></label><label>{t("notes")}<textarea className="field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label></div>
      <button className="primary" disabled={!selected || !form.title || !patientId || uploading} type="button" onClick={() => void submit()}>{uploading ? t("uploading") : t("save_record")}</button>{message && <p className="notice" role={message.includes("Unable") ? "alert" : "status"}>{message}</p>}
    </section>
    {queued.length > 0 && <section className="panel"><div className="section-title"><h2>{t("offline_queue")}</h2><button className="secondary" type="button" onClick={() => void retry()}>{t("sync_now")}</button></div><ul className="queue-list">{queued.map((item) => <li key={item.id}><span>{item.title}</span><span className={`status-chip status-${item.status}`}>{statusLabel[item.status]}{item.status === "syncing" ? ` ${item.progress}%` : ""}</span></li>)}</ul></section>}
    <section className="panel"><h2>{t("timeline")}</h2><div className="timeline">{[...records].sort((a, b) => b.recordDate.localeCompare(a.recordDate)).map((record) => <article className="timeline-item" key={record.id}><time>{record.recordDate}</time><div><h3>{record.title}</h3><p>{record.type}{record.sourceHospital ? ` · ${record.sourceHospital}` : ""}{record.sourceHospitalType ? ` · ${record.sourceHospitalType === "private" ? "Private Hospital" : "Government Hospital"}` : ""}{record.sourceDoctor ? ` · Treating doctor: ${record.sourceDoctor}` : ""}{record.notes ? ` · ${record.notes}` : ""}</p>{record.media.map((mediaId) => urls[mediaId] && <a key={mediaId} className="font-semibold text-medical-700 underline" href={urls[mediaId]} target="_blank" rel="noreferrer">Open uploaded report</a>)}</div></article>)}{prescriptions.map((item) => <article className="timeline-item" key={`prescription-${item._id}`}><time>{item.prescriptionDate}</time><div><h3>{item.medicineName}</h3><p>Prescription · {item.dosage} · {item.doctor}{item.notes ? ` · ${item.notes}` : ""}{item.source === "patient_reported" ? " · Patient-reported" : ""}</p></div></article>)}{records.length === 0 && prescriptions.length === 0 && <p>{t("no_records")}</p>}</div></section>
  </main></>;
}
