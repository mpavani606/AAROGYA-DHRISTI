import type { RequestHandler } from "express";
import { AuditLog } from "../models/AuditLog.js";
export const audit = (action: string, resource?: string): RequestHandler => async (req, _res, next) => {
  try {
    await AuditLog.create({ actor: req.user?.id, action, resource, resourceId: req.params.userId ?? req.params.hospitalId, ip: req.ip, userAgent: req.get("user-agent") });
    next();
  } catch (error) {
    next(error);
  }
};
