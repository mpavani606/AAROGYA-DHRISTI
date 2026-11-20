import api from "../auth/api";

export type Mandal = { _id: string; name?: string; name_en?: string; name_te?: string; name_hi?: string; teluguName?: string; phcCount?: number | null; villageCount?: number | null; habitationCount?: number | null };
export type MandalVillage = { _id: string; name: string; name_en?: string; name_te?: string; name_hi?: string; gramPanchayatName?: string | null; habitationCount: number | null };
export type MandalPhc = { _id: string; name: string; name_en?: string; name_te?: string; name_hi?: string; code: string; active: boolean; villages: MandalVillage[] };
export type MandalDetails = {
  mandal: Mandal;
  phcs: MandalPhc[];
  unassignedVillages: MandalVillage[];
  aggregates: { phcCount: number | null; villageCount: number | null; habitationCount: number | null };
};
export type Hospital = { _id: string; name: string; code?: string; type: string; ownershipType?: "government" | "private"; address?: string; phone?: string; services?: string[]; district?: string; districtName?: string; mandalId?: string; mandalName?: string; lat?: number; lng?: number; active: boolean; doctorCount?: number; activeDoctorCount?: number };
export type District = { _id: string; name: string; name_en?: string; code: string };
export type Doctor = { _id: string; name: string; username: string; email: string; phone: string; status: string; hospitalProfile?: { registrationNo?: string; specialty?: string; qualification?: string; verificationStatus?: "draft" | "pending" | "verified" | "rejected" | "suspended"; submittedAt?: string; documentCount?: number; hospital: { name?: string; code?: string } | null } | null; assignments?: Array<{ scope?: string; district?: string; mandal?: string; habitation?: string; phc?: string; hospital?: string }> };
export type DoctorDetails = {
  doctor: Doctor;
  profile: null | {
    id: string;
    registrationNo?: string;
    specialty?: string;
    qualification?: string;
    experienceYears?: number;
    professionalSummary?: string;
    verificationStatus: "draft" | "pending" | "verified" | "rejected" | "suspended";
    submittedAt?: string;
    hospital?: { name?: string; code?: string; active?: boolean } | null;
    documents: Array<{ id: string; type: string; originalName: string; downloadName?: string; size: number; reviewStatus: string; adminRemarks?: string; uploadedAt: string; verifiedAt?: string }>;
    verificationHistory: Array<{ status: string; reviewer: string; note?: string; createdAt: string }>;
  };
};
export type DoctorStats = { total: number; active: number; draft: number; pending: number; verified: number; rejected: number; suspended: number };
export type HospitalManager = { _id: string; name: string; username: string; email: string; phone?: string; status: string; mfaEnabled: boolean; hospitalId: { _id: string; name: string; code: string; active: boolean } | string };
export type AshaWorker = { _id: string; name: string; username: string; email?: string; phone?: string; status: "active" | "disabled"; mfaEnabled: boolean; assignments: Array<{ phc?: string; village?: string }> };
export type AshaAssignmentOptions = {
  phcs: Array<{ _id: string; name?: string; name_en?: string; district: string; mandal: string }>;
  villages: Array<{ _id: string; name?: string; name_en?: string; district: string; mandal: string; phc?: string }>;
};
export type HospitalOverview = {
  statistics: { totalHospitals: number; activeHospitals: number; inactiveHospitals: number; totalDoctors: number; activeDoctors: number; hospitalManagers: number };
  hospitals: Array<{ hospitalId: string; hospitalName: string; hospitalCode?: string; type: string; ownershipType: "government" | "private"; doctors: number; activeDoctors: number }>;
};
export type HospitalDetails = {
  hospital: Hospital;
  managers: Array<{ _id: string; name: string; username: string; email: string; status: string; mfaEnabled: boolean }>;
  doctors: Array<{ id: string; name?: string; username?: string; status?: string; specialty?: string; registrationNo?: string; availabilityCount: number }>;
  statistics: { assignedDoctors: number; activeDoctors: number; upcomingAppointments: number; completedAppointments: number };
  auditLogs: Array<{ _id: string; action: string; resource: string; createdAt: string; actor?: { name?: string; role?: string } }>;
};

export const getDistricts = async () => (await api.get<{ districts: District[] }>("/geo/districts")).data.districts;
export const getMandals = async (district?: string) => (await api.get<{ mandals: Mandal[] }>("/geo/mandals", { params: district ? { district } : {} })).data.mandals;
export const getMandal = async (id: string) => (await api.get<MandalDetails>(`/geo/mandals/${id}`)).data;
export const getHospitals = async (search = "") => (await api.get<{ hospitals: Hospital[] }>("/admin/hospitals", { params: { search } })).data.hospitals;
export const getHospitalOverview = async () => (await api.get<HospitalOverview>("/admin/overview")).data;
export const getHospitalDetails = async (id: string) => (await api.get<HospitalDetails>(`/admin/hospitals/${id}`)).data;
export const saveHospital = async (hospital: Partial<Hospital>) => hospital._id ? api.patch(`/admin/hospitals/${hospital._id}`, hospital) : api.post("/admin/hospitals", hospital);
export const getDoctors = async (search = "", verificationStatus?: NonNullable<Doctor["hospitalProfile"]>["verificationStatus"]) =>
  (await api.get<{ doctors: Doctor[]; stats: DoctorStats }>("/admin/doctors", { params: { search, verificationStatus } })).data;
export const getDoctorDetails = async (userId: string) => (await api.get<DoctorDetails>(`/admin/doctors/${userId}`)).data;
export const reviewDoctorVerification = (userId: string, decision: "verified" | "rejected" | "suspended", note?: string) =>
  api.patch(`/admin/doctors/${userId}/verification`, { decision, note });
export const setDoctorStatus = (userId: string, status: "active" | "disabled") =>
  api.patch(`/admin/doctors/${userId}/status`, { status });
export const getDoctorDocument = (userId: string, documentId: string) =>
  api.get(`/admin/doctors/${userId}/documents/${documentId}`, { responseType: "blob" });
export const createDoctor = async (doctor: { username: string; email: string; phone: string; password: string; mandalId?: string; mandalName?: string }) =>
  api.post("/admin/users", { ...doctor, name: doctor.username, role: "doctor", assignments: doctor.mandalId && doctor.mandalName ? [{ scope: "mandal", mandal: doctor.mandalId }, { scope: "mandal", mandal: doctor.mandalName }] : [] });
export const assignDoctorHospitalProfile = (userId: string, profile: { hospitalId: string; registrationNo: string; specialty: string }) =>
  api.post(`/admin/doctors/${userId}/hospital-profile`, profile);
export const saveDoctorAssignment = async (userId: string, mandalId: string, mandalName: string, assignments: NonNullable<Doctor["assignments"]>) =>
  api.patch(`/admin/users/${userId}/assignment`, { assignments: [...assignments.filter((assignment) => !assignment.mandal), ...(mandalId && mandalName ? [{ scope: "mandal", mandal: mandalId }, { scope: "mandal", mandal: mandalName }] : [])] });
export const getHospitalManagers = async (search = "") => (await api.get<{ managers: HospitalManager[] }>("/admin/hospital-managers", { params: { search } })).data.managers;
export const createHospitalManager = async (manager: { hospitalId: string; name: string; username: string; email: string; phone?: string }) =>
  (await api.post<{ manager: HospitalManager; setupToken: string; setupExpiresAt: string }>("/admin/hospital-managers", manager)).data;
export const setHospitalManagerStatus = async (userId: string, status: "active" | "disabled") =>
  api.patch(`/admin/hospital-managers/${userId}/status`, { status });
export const resetHospitalManagerPassword = async (userId: string) =>
  (await api.post<{ setupToken: string; setupExpiresAt: string }>(`/admin/hospital-managers/${userId}/password-reset`)).data;
export const getAshaAssignmentOptions = async () => (await api.get<AshaAssignmentOptions>("/admin/asha-workers/options")).data;
export const getAshaWorkers = async () => (await api.get<{ workers: AshaWorker[] }>("/admin/asha-workers")).data.workers;
export const createAshaWorker = async (input: { name: string; username: string; email?: string; phone?: string; phcId: string; villageId: string }) =>
  (await api.post<{ worker: AshaWorker; setupToken: string; setupExpiresAt: string }>("/admin/asha-workers", input)).data;
export const setAshaWorkerStatus = async (userId: string, status: "active" | "disabled") =>
  api.patch(`/admin/asha-workers/${userId}/status`, { status });
