import type { RequestHandler } from "express";

export const health: RequestHandler = (_req, res) => res.setHeader("Cache-Control", "no-store").json({ status: "ok", service: "aarogya-drishti-api" });
