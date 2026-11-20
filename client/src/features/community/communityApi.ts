import api from "../auth/api";

export type CommunityOptions = {
  mandals: Array<{ _id: string; name?: string; name_en?: string }>;
  phcs: Array<{ _id: string; name?: string; name_en?: string; mandal: string }>;
  villages: Array<{ _id: string; name?: string; name_en?: string; mandal: string; phc?: string }>;
  hospitals: Array<{ _id: string; name: string; code?: string }>;
  doctors: Array<{ id: string; name: string; hospitalId?: string }>;
};

export type Camp = {
  _id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "planned" | "open" | "completed" | "cancelled";
  mandal: { _id: string; name?: string; name_en?: string };
  phc: { _id: string; name?: string; name_en?: string };
  village: { _id: string; name?: string; name_en?: string };
  hospital?: { _id: string; name: string; code?: string };
  assignedDoctors: Array<{ _id: string; name: string }>;
  totals: { registered: number | "<5"; attended: number | "<5"; noShow: number | "<5" };
};

export type PatientHealthCamp = {
  _id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "planned" | "open";
  mandal?: { name?: string; name_en?: string; name_te?: string };
  phc?: { name?: string; name_en?: string };
  village?: { name?: string; name_en?: string; name_te?: string };
  hospital?: { name?: string; code?: string };
  assignedDoctors: Array<{ _id: string; name: string }>;
  participantStatus: "registered" | "attended" | "no_show" | null;
};

export type EmergencyRequest = {
  id: string;
  patientCode?: string;
  category: "urgent_help" | "transport" | "other";
  message?: string;
  status: "submitted" | "open" | "assigned" | "acknowledged" | "resolved" | "cancelled";
  assignedTo?: string;
  location: { lat: number; lng: number; expiresAt: string } | null;
  contactAvailable?: boolean;
  contactAttempts?: Array<{ attemptedAt: string; channel: string; outcome: string; note?: string }>;
  escalations?: Array<{ escalatedAt: string; reason: string; assignedTo?: string }>;
  resolutionNote?: string;
  createdAt: string;
};

export const getCommunityOptions = async () => (await api.get<CommunityOptions>("/community/camps/options")).data;
export const getCamps = async () => (await api.get<{ camps: Camp[] }>("/community/camps")).data.camps;
export const getOwnHealthCamps = async () => (await api.get<{ camps: PatientHealthCamp[] }>("/community/camps/mine")).data.camps;
export const registerOwnHealthCamp = (campId: string) =>
  api.post<{ participant: { id: string; status: NonNullable<PatientHealthCamp["participantStatus"]> } }>(`/community/camps/${campId}/register`);
export const createCamp = (body: {
  title: string; startsAt: string; endsAt: string; mandalId: string; phcId: string;
  villageId: string; hospitalId?: string; assignedDoctorIds: string[];
}) => api.post("/community/camps", body);
export const updateCampStatus = (campId: string, status: "open" | "completed" | "cancelled") =>
  api.patch(`/community/camps/${campId}/status`, { status });
export const registerCampParticipant = (campId: string, patientId: string, caseId?: string) =>
  api.post(`/community/camps/${campId}/participants`, { patientId, ...(caseId ? { caseId } : {}) });
export const recordCampAttendance = (campId: string, participantId: string, status: "attended" | "no_show") =>
  api.patch(`/community/camps/${campId}/participants/${participantId}/attendance`, { status });
export async function downloadCampReport(campId: string, format: "csv" | "pdf") {
  const { data } = await api.get(`/community/camps/${campId}/report`, { params: { format }, responseType: "blob" });
  const url = URL.createObjectURL(data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `health-camp-${campId}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
export const getEmergencyQueue = async () => (await api.get<{ requests: EmergencyRequest[]; notice: string }>("/community/emergency/requests")).data;
export const getMyEmergencyRequests = async () => (await api.get<{ requests: EmergencyRequest[]; notice: string }>("/community/emergency/requests/mine")).data;
export const createEmergencyRequest = (body: {
  clientRequestId: string;
  category: EmergencyRequest["category"];
  message: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  emergencyContactConsent?: true;
  locationShareId?: string;
}) =>
  api.post("/community/emergency/requests", body);
export const cancelEmergencyRequest = (requestId: string) => api.post(`/community/emergency/requests/${requestId}/cancel`);
export const updateEmergencyRequest = (requestId: string, body: {
  status: "assigned" | "acknowledged" | "resolved" | "cancelled";
  assignedTo?: string;
  resolutionNote?: string;
}) => api.patch(`/community/emergency/requests/${requestId}`, body);
export const getEmergencyContactDetails = async (requestId: string) =>
  (await api.get<{ contact: { name: string; phone: string; relationship: string }; consentAt: string }>(`/community/emergency/requests/${requestId}/contact-details`)).data;
export const recordEmergencyContactAttempt = (requestId: string, body: {
  channel: "phone" | "inapp" | "sms";
  outcome: "reached" | "no_answer" | "unavailable" | "not_attempted";
  note?: string;
}) => api.post(`/community/emergency/requests/${requestId}/contact-attempts`, body);
export const escalateEmergencyRequest = (requestId: string, body: { reason: string; assignedTo?: string }) =>
  api.post(`/community/emergency/requests/${requestId}/escalate`, body);
export const getEmergencyFacilities = async () => (await api.get<{
  facilities: Array<{ id: string; name: string; code?: string; type: string; address?: string; phone?: string; lat?: number; lng?: number; distanceKm: number | null; availability: "open" | "closed" | "unknown" }>;
  locationUsed: boolean;
  notice: string;
}>("/community/emergency/facilities")).data;
