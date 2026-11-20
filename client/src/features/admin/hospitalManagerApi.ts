import api from "../auth/api";

export type ManagerHospital = {
  id: string;
  name: string;
  code: string;
  type: string;
  active: boolean;
  address?: string;
  district?: string;
  mandal?: string;
  phone?: string;
  services?: string[];
  workingHours?: Record<string, unknown>;
};

export type ManagerDoctor = {
  id: string;
  name?: string;
  username?: string;
  status?: string;
  specialty?: string;
  registrationNo?: string;
  verificationStatus?: "draft" | "pending" | "verified" | "rejected" | "suspended";
  availability: Array<{ id: string; start: string; end: string; booked: boolean }>;
};

export type ManagerNotification = {
  _id: string;
  channel: string;
  template: string;
  language: string;
  status: string;
  createdAt: string;
  sentAt?: string;
};
export type ManagerMedicineInventory = {
  _id: string;
  medicineName: string;
  quantity: number;
  unit: string;
  updatedAt: string;
};

export const getManagerDashboard = async () => (await api.get("/hospital-manager/dashboard")).data as {
  hospital: ManagerHospital;
  counts: { doctors: number; activeDoctors: number; availableSlots: number; upcomingAppointments: number; completedAppointments: number };
  limitations: { patientCounts: string; operationalTasks: string; hospitalNotifications: string };
};

export const getManagerHospital = async () => (await api.get("/hospital-manager/hospital")).data as {
  hospital: ManagerHospital & { lat?: number; lng?: number };
  manager: { id: string; name: string; username: string; status: string; mfaEnabled: boolean };
};

export const updateManagerHospital = (hospital: { address?: string; phone?: string; services?: string[] }) =>
  api.patch("/hospital-manager/hospital", hospital);

export const getManagerDoctors = async (search = "") =>
  (await api.get<{ doctors: ManagerDoctor[]; total: number }>("/hospital-manager/doctors", { params: { search } })).data;

export const addManagerAvailability = (doctorId: string, start: string, end: string) =>
  api.post(`/hospital-manager/doctors/${doctorId}/availability`, { start, end });

export const removeManagerAvailability = (doctorId: string, slotId: string) =>
  api.delete(`/hospital-manager/doctors/${doctorId}/availability/${slotId}`);

export const getManagerMedicineInventory = async () =>
  (await api.get<{ inventory: ManagerMedicineInventory[] }>("/hospital-manager/medicine-inventory")).data.inventory;

export const saveManagerMedicineInventory = (medicine: { medicineName: string; quantity: number; unit: string }) =>
  api.put("/hospital-manager/medicine-inventory", medicine);

export const getManagerNotifications = async () =>
  (await api.get<{ notifications: ManagerNotification[] }>("/hospital-manager/notifications")).data.notifications;

export const markManagerNotificationRead = (notificationId: string) =>
  api.patch(`/hospital-manager/notifications/${notificationId}/read`);
