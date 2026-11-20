import api from "../auth/api";

export type DashboardFilter = {
  mandalId?: string;
  phcId?: string;
  villageId?: string;
  from?: string;
  to?: string;
};
export type DashboardSummary = {
  screeningCoverage: number | null;
  screeningCoverageDenominator: number;
  screenedAdults: number;
  usableImageRate: number | null;
  imagesAssessed: number;
  medianHoursToReview: number | null;
  referralCompletionRate: number | null;
  medianDaysToDiagnosis: number | null;
  biopsyCompletionRate: number | null;
  treatmentLinkageRate: number | null;
  lossToFollowUpRate: number | null;
  cessationUptake: number | null;
  notificationSuccessRate: number | null;
  missedAppointments: number;
  metricNotes: Record<string, string>;
};
export type DashboardHotspot = {
  villageId: string;
  name: string;
  mandalId: string;
  phcId: string;
  lat: number | null;
  lng: number | null;
  screened: number | "<5";
};
export type VillageCoverageRow = {
  villageId: string;
  name: string;
  totalHabitations: number | "<5";
  screenedHabitations: number | "<5";
  pendingHabitations: number | "<5";
  averageCoverage: number;
};

const params = (filters: DashboardFilter) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
export const getDashboardSummary = async (filters: DashboardFilter) =>
  (await api.get<{ summary: DashboardSummary }>("/dashboard/summary", { params: params(filters) })).data.summary;
export const getDashboardHotspots = async (filters: DashboardFilter) =>
  (await api.get<{ hotspots: DashboardHotspot[] }>("/dashboard/hotspots", { params: params(filters) })).data.hotspots;
export const getDashboardVillageCoverage = async (filters: DashboardFilter) =>
  (await api.get<{ villages: VillageCoverageRow[] }>("/dashboard/village-coverage", { params: params(filters) })).data.villages;
export const getDashboardQuality = async (filters: DashboardFilter) =>
  (await api.get("/dashboard/data-quality", { params: params(filters) })).data.dataQuality as Record<string, number | string | null>;
export const getDashboardAsha = async (id: string, filters: DashboardFilter) =>
  (await api.get("/dashboard/asha/" + encodeURIComponent(id), { params: params(filters) })).data.activity as Record<string, number | string | null>;
export async function exportDashboard(filters: DashboardFilter) {
  const response = await api.get("/dashboard/export", { params: params(filters), responseType: "blob" });
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "district-dashboard-aggregate.csv";
  link.click();
  URL.revokeObjectURL(url);
}
