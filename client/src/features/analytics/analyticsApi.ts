import api from "../auth/api";

export type AnalyticsFilters = {
  from?: string;
  to?: string;
  mandalId?: string;
  hospitalId?: string;
  screeningStatus?: string;
  referralStatus?: string;
  followUpStatus?: string;
  appointmentStatus?: string;
  page?: number;
  pageSize?: number;
};
export type AnalyticsSummary = {
  scope: string;
  totals: {
    registeredPatients: number | null;
    doctors: { total: number; active: number; verified: number; pendingVerification: number };
    activeHospitals: number;
    screenings: { total: number; pendingReview: number; completedReview: number; byStatus: Record<string, number> };
    referrals: { total: number; completed: number; byStatus: Record<string, number> };
    followUps: { total: number; completed: number; byStatus: Record<string, number> };
    appointments: { total: number; upcoming: number; byStatus: Record<string, number> };
  };
  monthlyTrend: Array<{ _id: string; screenings: number; reviews: number; referrals: number }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type AiMonitoring = {
  mode: string;
  clinicalValidated: boolean;
  period: { from: string; to: string };
  totals: { completed: number; failed: number; unavailable: number; averageDurationMs: number | null; maxDurationMs: number | null };
  modelVersions: Array<{ version: string; requests: number }>;
  dailyMetrics: Array<{ date: string; completed: number; failed: number; unavailable: number; averageDurationMs: number | null }>;
  recentErrors: Array<{ status: string; errorCode: string; createdAt: string }>;
};
export type SystemHealth = {
  checkedAt: string;
  api: { status: string; requestMetrics: { windowMinutes: number; totalRequests: number; errorRequests: number; serverErrors: number } };
  database: { status: string; readyState: number };
  mediaStorage: { mode: string; status: string };
  aiScreening: { status: string; mode: string; clinicalValidated: boolean };
  notifications: { status: string; periodHours: number; queued: number; failed: number; sent: number };
  backgroundJobs: Array<{ name: string; schedule: string; state: string; lastStartedAt?: string; lastCompletedAt?: string; lastFailedAt?: string; runCount: number }>;
  process: { scope: string; uptimeSeconds: number };
};

const queryParams = (filters: AnalyticsFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value));

export async function getOperationalAnalytics(filters: AnalyticsFilters) {
  return (await api.get<AnalyticsSummary>("/analytics/overview", { params: queryParams(filters) })).data;
}
export async function getAiMonitoring(filters: Pick<AnalyticsFilters, "from" | "to">) {
  return (await api.get<AiMonitoring>("/ai-monitoring", { params: queryParams(filters) })).data;
}
export async function getSystemHealth() {
  return (await api.get<SystemHealth>("/system-health")).data;
}
export async function downloadOperationalReport(filters: AnalyticsFilters, format: "csv" | "pdf", report: "analytics" | "ai" = "analytics") {
  const { data } = await api.get("/operational-reports", {
    params: { ...queryParams(filters), format, report },
    responseType: "blob"
  });
  const url = URL.createObjectURL(data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report}-operations.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
