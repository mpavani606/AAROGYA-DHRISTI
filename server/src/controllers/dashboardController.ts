import type { RequestHandler } from "express";
import { z } from "zod";
import {
  auditDashboardExport,
  dashboardCsv,
  getAshaActivity,
  getDataQuality,
  getDashboardSummary,
  getHotspots,
  getVillageCoverage,
  type DashboardFilters
} from "../services/dashboardService.js";
import { permittedDashboardMandals } from "../services/dashboardService.js";

const querySchema = z.object({
  mandalId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  phcId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  villageId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
}).refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
  message: "from must be earlier than or equal to to"
});

async function requestFilters(req: Parameters<RequestHandler>[0]) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw Object.assign(new Error("Invalid dashboard filters."), { status: 400, code: "VALIDATION_ERROR" });
  const filters: DashboardFilters = {
    ...(parsed.data.mandalId ? { mandalId: parsed.data.mandalId } : {}),
    ...(parsed.data.phcId ? { phcId: parsed.data.phcId } : {}),
    ...(parsed.data.villageId ? { villageId: parsed.data.villageId } : {}),
    ...(parsed.data.from ? { from: new Date(parsed.data.from) } : {}),
    ...(parsed.data.to ? { to: new Date(parsed.data.to) } : {})
  };
  const permitted = await permittedDashboardMandals(req.user);
  if (filters.mandalId && permitted && !permitted.includes(filters.mandalId)) {
    throw Object.assign(new Error("This mandal is outside your assigned area."), { status: 403, code: "FORBIDDEN" });
  }
  return { filters, permitted };
}

const sendError = (res: Parameters<RequestHandler>[1], error: unknown) => {
  const e = error as Error & { status?: number; code?: string };
  return res.status(e.status ?? 500).json({ error: {
    code: e.code ?? "DASHBOARD_ERROR",
    message_en: e.status ? e.message : "Dashboard data could not be loaded.",
    message_te: "డాష్‌బోర్డ్ డేటాను లోడ్ చేయలేకపోయాము.",
    message_hi: "डैशबोर्ड डेटा लोड नहीं किया जा सका।"
  } });
};

export const dashboardSummary: RequestHandler = async (req, res, next) => {
  try { const { filters, permitted } = await requestFilters(req); res.json({ summary: await getDashboardSummary(filters, permitted) }); }
  catch (error) { if ((error as { status?: number }).status) sendError(res, error); else next(error); }
};
export const dashboardHotspots: RequestHandler = async (req, res, next) => {
  try { const { filters, permitted } = await requestFilters(req); res.json({ hotspots: await getHotspots(filters, permitted) }); }
  catch (error) { if ((error as { status?: number }).status) sendError(res, error); else next(error); }
};
export const dashboardVillageCoverage: RequestHandler = async (req, res, next) => {
  try { const { filters, permitted } = await requestFilters(req); res.json({ villages: await getVillageCoverage(filters, permitted) }); }
  catch (error) { if ((error as { status?: number }).status) sendError(res, error); else next(error); }
};
export const dashboardDataQuality: RequestHandler = async (req, res, next) => {
  try { const { filters, permitted } = await requestFilters(req); res.json({ dataQuality: await getDataQuality(filters, permitted) }); }
  catch (error) { if ((error as { status?: number }).status) sendError(res, error); else next(error); }
};
export const dashboardAsha: RequestHandler = async (req, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(String(req.params.id))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Invalid ASHA identifier." } });
    const { filters, permitted } = await requestFilters(req);
    const activity = await getAshaActivity(String(req.params.id), filters, permitted);
    if (!activity) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "ASHA activity is not available in this area." } });
    res.json({ activity });
  } catch (error) { if ((error as { status?: number }).status) sendError(res, error); else next(error); }
};
export const dashboardExport: RequestHandler = async (req, res, next) => {
  try {
    const { filters, permitted } = await requestFilters(req);
    const summary = await getDashboardSummary(filters, permitted);
    await auditDashboardExport(req.user!.id, req.ip, filters);
    res.type("text/csv").setHeader("Content-Disposition", 'attachment; filename="district-dashboard-aggregate.csv"');
    res.send(dashboardCsv(summary));
  } catch (error) { if ((error as { status?: number }).status) sendError(res, error); else next(error); }
};
