import type { RequestHandler } from "express";

type MinuteBucket = { minute: number; total: number; errors: number; serverErrors: number };
const buckets = new Map<number, MinuteBucket>();
const WINDOW_MINUTES = 60;

export const requestMetrics: RequestHandler = (_req, res, next) => {
  res.on("finish", () => {
    const minute = Math.floor(Date.now() / 60_000);
    const bucket = buckets.get(minute) ?? { minute, total: 0, errors: 0, serverErrors: 0 };
    bucket.total += 1;
    if (res.statusCode >= 400) bucket.errors += 1;
    if (res.statusCode >= 500) bucket.serverErrors += 1;
    buckets.set(minute, bucket);
    for (const key of buckets.keys()) if (key < minute - WINDOW_MINUTES + 1) buckets.delete(key);
  });
  next();
};

export function getRequestMetrics(now = Date.now()) {
  const firstMinute = Math.floor(now / 60_000) - WINDOW_MINUTES + 1;
  const recent = [...buckets.values()].filter((bucket) => bucket.minute >= firstMinute);
  return {
    windowMinutes: WINDOW_MINUTES,
    totalRequests: recent.reduce((total, bucket) => total + bucket.total, 0),
    errorRequests: recent.reduce((total, bucket) => total + bucket.errors, 0),
    serverErrors: recent.reduce((total, bucket) => total + bucket.serverErrors, 0)
  };
}
