import api from "../auth/api";

export type AshaPatient = {
  _id?: string;
  id?: string;
  name: string;
  phone?: string;
  ageYears?: number;
  address?: string;
  villageId?: string;
  phcId?: string;
};

export type AshaVisit = {
  _id: string;
  visitedAt: string;
  outcome: "contacted" | "not_available" | "follow_up_needed" | "referred";
  nextFollowUpAt?: string;
  notes?: string;
};

export type AshaCampParticipant = {
  id: string;
  patientId: string;
  status: "registered" | "attended" | "no_show";
  attendedAt?: string;
};

export const getAshaDashboard = async () => (await api.get<{
  summary: { patients: number; dueVisits: number; visitsLast30Days: number; pendingReferrals: number };
  phcs: Array<{ _id: string; name?: string; name_en?: string }>;
  villages: Array<{ _id: string; name?: string; name_en?: string; phc: string; mandal: string }>;
}>("/asha/dashboard")).data;

export const getAssignedAshaPatients = async () =>
  (await api.get<{ patients: AshaPatient[] }>("/asha/patients")).data.patients;

export const registerAshaPatient = async (input: {
  name: string;
  phone: string;
  ageYears: number;
  address?: string;
  phcId: string;
  villageId: string;
  preferredLanguage: "en" | "te" | "hi";
  registrationConsent: true;
  screeningConsent: boolean;
}) => (await api.post<{ patient: AshaPatient }>("/asha/patients", input)).data.patient;

export const grantAshaScreeningConsent = (patientId: string) =>
  api.post(`/asha/patients/${patientId}/screening-consent`, { confirmedByPatient: true });

export const recordAshaVisit = async (patientId: string, input: {
  outcome: AshaVisit["outcome"];
  nextFollowUpAt?: string;
  notes?: string;
}) => (await api.post<{ visit: AshaVisit }>(`/asha/patients/${patientId}/visits`, input)).data.visit;

export const getAshaPatientHistory = async (patientId: string) =>
  (await api.get<{
    visits: AshaVisit[];
    screenings: Array<{ id: string; status: string; createdAt: string }>;
    followUps: Array<{ scheduledAt: string; status: string }>;
    referrals: Array<{ status: string; priority: string; specialty?: string; createdAt: string }>;
    camps: Array<{ status: string; camp?: { title?: string }; createdAt: string }>;
  }>(`/asha/patients/${patientId}/history`)).data;

export const getAshaActivityReport = async () => (await api.get<{
  totalVisits: number;
  upcomingFollowUps: number;
  byOutcome: Array<{ outcome: string; count: number }>;
}>("/asha/activity-report")).data;

export const getAshaCampParticipants = async (campId: string) =>
  (await api.get<{ participants: AshaCampParticipant[] }>(`/asha/camps/${campId}/participants`)).data.participants;
