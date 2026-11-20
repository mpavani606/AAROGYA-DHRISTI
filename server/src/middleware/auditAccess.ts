import type { RequestHandler } from "express";
import { AuditLog } from "../models/AuditLog.js";

const actionFor = (method: string, path: string) => {
  if (/\/export(?:\?|$)/i.test(path)) return "export";
  if (method === "GET" || method === "HEAD") return "read";
  if (method === "POST") return "create";
  if (method === "DELETE") return "delete";
  return "edit";
};

const safeResourcePath = (path: string) => path
  .split("?")[0]
  .replace(/[a-f\d]{24}/gi, ":id")
  .replace(/\b\d{6,}\b/g, ":id")
  .slice(0, 250);

export const auditAccess: RequestHandler = async (req, _res, next) => {
  try {
    const resource = safeResourcePath(req.originalUrl);
    await AuditLog.create({
      actor: req.user?.id,
      action: actionFor(req.method, req.originalUrl),
      resource,
      ip: req.ip,
      userAgent: req.get("user-agent")
    });
    next();
  } catch (error) {
    next(error);
  }
};
