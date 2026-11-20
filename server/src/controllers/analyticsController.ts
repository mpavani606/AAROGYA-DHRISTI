import type { RequestHandler } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { getAnalyticsOverview } from "../services/analyticsService.js";
import { getAiOperationsMonitoring, getDetailedSystemHealth } from "../services/operationsMonitoringService.js";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date.");
const querySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  districtId: objectIdSchema.optional(),
  mandalId: objectIdSchema.optional(),
  phcId: objectIdSchema.optional(),
  villageId: objectIdSchema.optional(),
  hospitalId: objectIdSchema.optional(),
  screeningStatus: z.enum(["draft", "submitted", "ai_processed", "in_review", "routine_follow_up", "specialist_review", "urgent_referral", "recapture_requested", "deferred", "investigation_advised", "report_received", "clinician_reviewed", "treatment_linked", "follow_up", "closed_clinically", "lost_to_follow_up"]).optional(),
  referralStatus: z.enum(["not_required", "recommended", "requested", "accepted", "scheduled", "completed", "cancelled"]).optional(),
  followUpStatus: z.enum(["pending", "scheduled", "completed", "missed", "rescheduled", "cancelled"]).optional(),
  appointmentStatus: z.enum(["requested", "confirmed", "rescheduled", "attended", "missed", "cancelled", "assessment_completed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  report: z.enum(["analytics", "ai"]).default("analytics"),
  format: z.enum(["csv", "pdf"]).default("csv")
}).strict();

function parseQuery(query: unknown) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid analytics filter." };
  const from = parsed.data.from ? new Date(parsed.data.from) : undefined;
  const to = parsed.data.to ? new Date(parsed.data.to) : undefined;
  if (from && to && from > to) return { error: "The start date must be on or before the end date." };
  if (from && to && to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) return { error: "Analytics date range cannot exceed 366 days." };
  return {
    data: {
      ...parsed.data,
      from,
      to,
      ...(parsed.data.from || parsed.data.to ? {} : { from: undefined })
    }
  };
}

function aiPeriod(from?: Date, to?: Date) {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - 24 * 60 * 60 * 1000);
  if (start > end) return { error: "AI monitoring start date must be on or before its end date." };
  if (end.getTime() - start.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return { error: "AI operations date range cannot exceed 90 days." };
  }
  return { start, end };
}

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function analyticsRows(data: Awaited<ReturnType<typeof getAnalyticsOverview>>) {
  const rows: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(data.totals)) {
    if (key === "geographicUnits") continue;
    if (value && typeof value === "object") {
      for (const [metric, count] of Object.entries(value)) {
        if (count && typeof count === "object") {
          for (const [status, statusCount] of Object.entries(count)) rows.push([`${key}.${metric}.${status}`, statusCount]);
        } else {
          rows.push([`${key}.${metric}`, count]);
        }
      }
    } else rows.push([key, value]);
  }
  for (const item of data.monthlyTrend) {
    rows.push([`monthly.${item._id}.screenings`, item.screenings]);
    rows.push([`monthly.${item._id}.reviews`, item.reviews]);
    rows.push([`monthly.${item._id}.referrals`, item.referrals]);
  }
  return rows;
}

async function renderPdf(title: string, rows: Array<[string, unknown]>) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: title, Author: "Aarogya Drishti" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(18).text(title);
    doc.moveDown(0.5).fontSize(9).fillColor("#475569").text("Simulation data. Not for clinical use. Aggregated metrics only.");
    doc.moveDown().fillColor("#0f172a").fontSize(10);
    for (const [label, value] of rows) doc.text(`${label}: ${value ?? "—"}`, { lineBreak: true });
    doc.end();
  });
}

async function recordExport(req: Parameters<RequestHandler>[0], report: string, format: string, filterCount: number) {
  await AuditLog.create({
    actor: req.user?.id,
    action: "aggregate_operational_report_exported",
    resource: "Analytics",
    ip: req.ip,
    userAgent: req.get("user-agent"),
    metadata: { report, format, role: req.user?.role, filterCount }
  });
}

export const analyticsOverview: RequestHandler = async (req, res, next) => {
  try {
    const parsed = parseQuery(req.query);
    if ("error" in parsed) return res.status(400).json({ error: { code: "INVALID_ANALYTICS_FILTER", message_en: parsed.error } });
    const data = await getAnalyticsOverview(req.user!, parsed.data);
    res.setHeader("Cache-Control", "no-store").json(data);
  } catch (error) { next(error); }
};

export const aiOperationsMonitoring: RequestHandler = async (req, res, next) => {
  try {
    const parsed = parseQuery(req.query);
    if ("error" in parsed) return res.status(400).json({ error: { code: "INVALID_ANALYTICS_FILTER", message_en: parsed.error } });
    const period = aiPeriod(parsed.data.from, parsed.data.to);
    if ("error" in period) return res.status(400).json({ error: { code: "INVALID_ANALYTICS_FILTER", message_en: period.error } });
    res.setHeader("Cache-Control", "no-store").json(await getAiOperationsMonitoring(period.start, period.end));
  } catch (error) { next(error); }
};

export const detailedSystemHealth: RequestHandler = async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store").json(await getDetailedSystemHealth());
  } catch (error) { next(error); }
};

export const operationalReport: RequestHandler = async (req, res, next) => {
  try {
    const parsed = parseQuery(req.query);
    if ("error" in parsed) return res.status(400).json({ error: { code: "INVALID_ANALYTICS_FILTER", message_en: parsed.error } });
    if (parsed.data.report === "ai" && req.user?.role !== "system_admin") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message_en: "AI operations reports require System Admin access." } });
    }
    const analytics = parsed.data.report === "analytics" ? await getAnalyticsOverview(req.user!, parsed.data) : undefined;
    const period = parsed.data.report === "ai" ? aiPeriod(parsed.data.from, parsed.data.to) : undefined;
    if (period && "error" in period) return res.status(400).json({ error: { code: "INVALID_ANALYTICS_FILTER", message_en: period.error } });
    const ai = period && "start" in period ? await getAiOperationsMonitoring(period.start, period.end) : undefined;
    const reportTitle = parsed.data.report === "ai" ? "AI operations report" : "Operational analytics report";
    const rows: Array<[string, unknown]> = analytics ? analyticsRows(analytics) : [
      ["mode", ai?.mode],
      ["clinicalValidated", ai?.clinicalValidated],
      ["completedRequests", ai?.totals.completed],
      ["failedRequests", ai?.totals.failed],
      ["unavailableRequests", ai?.totals.unavailable],
      ["averageDurationMs", ai?.totals.averageDurationMs],
      ["maxDurationMs", ai?.totals.maxDurationMs]
    ];
    if (ai) {
      for (const model of ai.modelVersions) rows.push([`model.${model.version}.requests`, model.requests]);
      for (const day of ai.dailyMetrics) {
        rows.push([`daily.${day.date}.completed`, day.completed]);
        rows.push([`daily.${day.date}.failed`, day.failed]);
        rows.push([`daily.${day.date}.unavailable`, day.unavailable]);
        rows.push([`daily.${day.date}.averageDurationMs`, day.averageDurationMs]);
      }
      for (const [index, error] of ai.recentErrors.entries()) rows.push([`recentError.${index + 1}`, `${error.status}:${error.errorCode}:${error.createdAt.toISOString()}`]);
    }
    await recordExport(req, parsed.data.report, parsed.data.format, ["from", "to", "districtId", "mandalId", "phcId", "villageId", "hospitalId", "screeningStatus", "referralStatus", "followUpStatus", "appointmentStatus"].filter((key) => key in req.query).length);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${parsed.data.report}-operations.${parsed.data.format}"`);
    if (parsed.data.format === "csv") {
      const csv = [["metric", "value"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.type("text/csv; charset=utf-8").send(csv);
      return;
    }
    const pdf = await renderPdf(reportTitle, rows);
    res.type("application/pdf").send(pdf);
  } catch (error) { next(error); }
};
