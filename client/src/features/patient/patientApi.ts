import api from "../auth/api";

export type PatientDraft = {
  abhaChoice: string;
  abhaId?: string;
  name: string;
  phone: string;
  dateOfBirth: string;
  address: string;
  familyMembers: Array<{ name: string; relationship: string; age: string }>;
  consent: boolean;
  mandal?: string;
  preferredLanguage?: "en" | "te" | "hi";
};

export async function checkPatientDuplicate(phone: string, name: string, mandal: string) {
  const { data } = await api.post("/patients/duplicate-check", { phone, name, mandal });
  return Boolean(data.duplicate ?? data.isDuplicate);
}

export async function createPatientRegistration(draft: PatientDraft) {
  const mandal = draft.mandal?.trim();
  if (!mandal) throw new Error("Mandal is required to register a patient.");
  const { data } = await api.post("/patients", {
    name: draft.name.trim(),
    ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
    ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
    ...(draft.dateOfBirth.trim() ? { dateOfBirth: draft.dateOfBirth.trim() } : {}),
    ...(draft.abhaId?.trim() ? { abha: draft.abhaId.trim() } : {}),
    mandal,
    preferredLanguage: draft.preferredLanguage ?? "en",
  });
  const patientId = data.patient?._id ?? data.patient?.id;
  if (!patientId) throw new Error("The patient was saved but the server did not return a patient identifier.");
  if (draft.consent) {
    await api.post(`/patients/${patientId}/consents`, { purpose: "registration", granted: true });
  }
  return data;
}

export async function uploadAarogyasri(file: File) {
  const body = new FormData();
  body.append("document", file);
  const { data } = await api.post("/patients/aarogyasri/extract", body, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export type PatientProfile = {
  id: string;
  _id?: string;
  name: string;
  phone?: string;
  address?: string;
  dateOfBirth?: string;
  gender?: string;
  ageYears?: number;
  patientCode?: string;
  mandal?: string;
  village?: string;
  phcId?: string;
  habits?: { tobacco?: string; alcohol?: string; exercise?: string; diet?: string };
  version?: number;
};

export type HealthWorker = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

export async function getOwnHealthWorkers() {
  const { data } = await api.get<{ workers: HealthWorker[] }>("/patients/me/health-workers");
  return data.workers;
}

export type RefillRequest = {
  _id: string;
  medicineName: string;
  dosage?: string;
  quantity: number;
  notes?: string;
  status: "pending" | "requested" | "reviewed" | "fulfilled" | "declined";
  createdAt: string;
};
export type Prescription = {
  _id: string;
  medicineName: string;
  dosage: string;
  doctor: string;
  prescriptionDate: string;
  notes?: string;
  source: "patient_reported" | "clinician" | "demo";
  isDemoData?: boolean;
};
export type MedicineAvailability = {
  medicineName: string;
  availability: "recorded" | "not_recorded" | "not_found";
  facilities: Array<{
    medicineName: string;
    hospital: string;
    address?: string | null;
    phone?: string | null;
    quantity: number;
    unit: string;
    availability: "available" | "out_of_stock";
    synthetic?: boolean;
    updatedAt: string;
  }>;
};

export async function getOwnMedicineAvailability(medicineName: string) {
  const { data } = await api.get<MedicineAvailability>("/patients/me/medicine-availability", { params: { medicineName } });
  return data;
}

export async function updateOwnPatientProfile(fields: Pick<PatientProfile, "name" | "address" | "dateOfBirth" | "gender">) {
  const { data } = await api.patch("/patients/me", fields);
  const patient = data.patient;
  return { ...patient, id: patient._id ?? patient.id } as PatientProfile;
}

export async function getOwnRefillRequests() {
  const { data } = await api.get<{ requests: RefillRequest[]; availability: "unknown" }>("/patients/me/refills");
  return data;
}

export async function getOwnPrescriptions() {
  const { data } = await api.get<{ prescriptions: Prescription[] }>("/patients/me/prescriptions");
  return data.prescriptions;
}

export async function createOwnPrescription(body: Omit<Prescription, "_id" | "source">) {
  const { data } = await api.post<{ prescription: Prescription }>("/patients/me/prescriptions", body);
  return data.prescription;
}

export async function createOwnRefillRequest(body: {
  clientUuid: string;
  prescriptionRecordId?: string;
  prescriptionId?: string;
  medicineName: string;
  dosage?: string;
  quantity: number;
  notes?: string;
}) {
  const { data } = await api.post<{ request: RefillRequest; availability: "unknown" }>("/patients/me/refills", body);
  return data;
}

export async function downloadOwnMedicalReport(patientId: string) {
  const { data } = await api.get(`/patients/${patientId}/medical-report`, { responseType: "blob" });
  const url = URL.createObjectURL(data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "patient-medical-report.pdf";
  link.click();
  URL.revokeObjectURL(url);
}

export type PatientRecord = {
  id: string;
  title: string;
  type: string;
  recordDate: string;
  sourceHospital?: string;
  sourceHospitalType?: "government" | "private";
  sourceDoctor?: string;
  media: string[];
  notes?: string;
  thumbnailUrl?: string;
  signedUrl?: string;
  createdAt?: string;
};

export async function getPatientProfile() {
  const { data } = await api.get("/patients/me");
  const patient = data.patient ?? data;
  return { ...patient, id: patient._id ?? patient.id } as PatientProfile;
}

export async function getPatientRecords(patientId: string) {
  const { data } = await api.get(`/patients/${patientId}/timeline`);
  type TimelineRecord = {
    _id?: string;
    id?: string;
    title: string;
    recordType?: string;
    type?: string;
    recordDate?: string;
    createdAt?: string;
    sourceHospital?: string;
    sourceHospitalType?: "government" | "private";
    sourceDoctor?: string;
    notes?: string;
    media?: Array<string | { _id: string }>;
  };
  return ((data.events ?? []) as Array<{ record?: TimelineRecord }>).flatMap((event) => {
    const record = event.record;
    const id = record?._id ?? record?.id;
    if (!record || !id) return [];
    return [{
      ...record,
      id,
      type: record.recordType ?? record.type ?? "Other",
      recordDate: record.recordDate ?? record.createdAt ?? "",
      media: (record.media ?? []).map((item) => typeof item === "string" ? item : item._id)
    }];
  });
}

export async function getRecordSignedUrl(patientId: string, recordId: string) {
  const { data } = await api.get(`/media/${recordId}/signed-url`);
  return new URL(String(data.url ?? data.signedUrl), api.defaults.baseURL ?? window.location.origin).toString();
}

export async function uploadPatientRecord(patientId: string, item: { file: Blob; title: string; type: string; recordDate: string; sourceHospital?: string; sourceHospitalType?: "government" | "private"; sourceDoctor?: string; notes: string }, onProgress?: (value: number) => void) {
  const body = new FormData();
  body.append("file", item.file, item.file instanceof File ? item.file.name : "record");
  body.append("title", item.title);
  body.append("recordType", item.type);
  body.append("recordDate", item.recordDate);
  if (item.sourceHospital?.trim()) body.append("sourceHospital", item.sourceHospital.trim());
  if (item.sourceHospitalType) body.append("sourceHospitalType", item.sourceHospitalType);
  if (item.sourceDoctor?.trim()) body.append("sourceDoctor", item.sourceDoctor.trim());
  body.append("notes", item.notes);
  const { data } = await api.post(`/patients/${patientId}/records`, body, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (event) => onProgress?.(event.total ? Math.round((event.loaded / event.total) * 100) : 0),
  });
  return (data.record ?? data) as PatientRecord;
}
