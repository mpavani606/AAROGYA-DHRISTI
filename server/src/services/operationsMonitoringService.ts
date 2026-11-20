import mongoose from "mongoose";
import { AiServiceEvent } from "../models/AiServiceEvent.js";
import { Notification } from "../models/Notification.js";
import { getRequestMetrics } from "../middleware/requestMetrics.js";
import { getScheduledJobs } from "./jobMonitoring.js";
import { inspectMediaStorage } from "./mediaService.js";
import { logger } from "./logger.js";

export async function getAiOperationsMonitoring(from?: Date, to = new Date()) {
  const start = from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const [statusRows, versionRows, dailyRows, recentErrors] = await Promise.all([
    AiServiceEvent.aggregate([
      { $match: { createdAt: { $gte: start, $lte: to } } },
      { $group: { _id: "$status", count: { $sum: 1 }, averageDurationMs: { $avg: "$durationMs" }, maxDurationMs: { $max: "$durationMs" } } },
      { $sort: { _id: 1 } }
    ]),
    AiServiceEvent.aggregate([
      { $match: { createdAt: { $gte: start, $lte: to } } },
      { $group: { _id: "$modelVersion", requests: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    AiServiceEvent.aggregate([
      { $match: { createdAt: { $gte: start, $lte: to } } },
      { $group: {
        _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, status: "$status" },
        requests: { $sum: 1 },
        averageDurationMs: { $avg: "$durationMs" }
      } },
      { $sort: { "_id.day": 1 } }
    ]),
    AiServiceEvent.find({ createdAt: { $gte: start, $lte: to }, status: { $ne: "completed" } })
      .select("status errorCode createdAt -_id").sort({ createdAt: -1 }).limit(10).lean()
  ]);
  const totals = Object.fromEntries(statusRows.map((row) => [row._id, {
    requests: row.count,
    averageDurationMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
    maxDurationMs: row.maxDurationMs
  }]));
  const dailyMetrics = new Map<string, {
    date: string;
    completed: number;
    failed: number;
    unavailable: number;
    durationTotal: number;
    durationCount: number;
  }>();
  for (const row of dailyRows) {
    const date = row._id.day as string;
    const daily = dailyMetrics.get(date) ?? { date, completed: 0, failed: 0, unavailable: 0, durationTotal: 0, durationCount: 0 };
    if (row._id.status === "completed") daily.completed = row.requests;
    if (row._id.status === "failed") daily.failed = row.requests;
    if (row._id.status === "unavailable") daily.unavailable = row.requests;
    if (row.averageDurationMs !== null) {
      daily.durationTotal += row.averageDurationMs * row.requests;
      daily.durationCount += row.requests;
    }
    dailyMetrics.set(date, daily);
  }
  return {
    mode: "local_deterministic_demo",
    clinicalValidated: false,
    period: { from: start.toISOString(), to: to.toISOString() },
    totals: {
      completed: totals.completed?.requests ?? 0,
      failed: totals.failed?.requests ?? 0,
      unavailable: totals.unavailable?.requests ?? 0,
      averageDurationMs: statusRows.length ? Math.round(statusRows.reduce((sum, row) => sum + (row.averageDurationMs ?? 0) * row.count, 0) / Math.max(1, statusRows.reduce((sum, row) => sum + row.count, 0))) : null,
      maxDurationMs: statusRows.length ? Math.max(...statusRows.map((row) => row.maxDurationMs ?? 0)) : null
    },
    byStatus: totals,
    modelVersions: versionRows.map((row) => ({ version: row._id, requests: row.requests })),
    dailyMetrics: [...dailyMetrics.values()].map(({ date, completed, failed, unavailable, durationTotal, durationCount }) => ({
      date,
      completed,
      failed,
      unavailable,
      averageDurationMs: durationCount ? Math.round(durationTotal / durationCount) : null
    })),
    recentErrors: recentErrors.map((row) => ({ status: row.status, errorCode: row.errorCode ?? "UNKNOWN", createdAt: row.createdAt }))
  };
}

export async function getDetailedSystemHealth() {
  const mongoConnected = mongoose.connection.readyState === 1;
  let databaseStatus: "healthy" | "disconnected" | "unavailable" = mongoConnected ? "healthy" : "disconnected";
  if (mongoConnected && mongoose.connection.db) {
    try {
      await mongoose.connection.db.admin().ping();
    } catch (error) {
      databaseStatus = "unavailable";
      logger.error({ error }, "System health database ping failed");
    }
  }
  const databaseAvailable = databaseStatus === "healthy";
  const [storage, notificationRows] = await Promise.all([
    inspectMediaStorage(),
    databaseAvailable ? Notification.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]) : Promise.resolve([])
  ]);
  const notifications = Object.fromEntries(notificationRows.map((row) => [row._id, row.count])) as Record<string, number>;
  const jobs = getScheduledJobs();
  return {
    checkedAt: new Date().toISOString(),
    api: { status: "available", requestMetrics: getRequestMetrics() },
    database: { status: databaseStatus, readyState: mongoose.connection.readyState },
    mediaStorage: storage,
    aiScreening: { status: "available", mode: "local_deterministic_demo", clinicalValidated: false },
    notifications: {
      status: databaseAvailable ? "available" : "unavailable",
      periodHours: 24,
      queued: notifications.queued ?? 0,
      failed: notifications.failed ?? 0,
      sent: notifications.sent ?? 0
    },
    backgroundJobs: jobs,
    process: { scope: "current_api_process", uptimeSeconds: Math.floor(process.uptime()) }
  };
}
