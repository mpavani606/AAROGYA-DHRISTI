import type { RequestHandler } from "express";
import { AuditLog } from "../models/AuditLog.js";
export const hasRequiredRole = (role: string | undefined, roles: string[]) => Boolean(role && roles.includes(role));
export const requireRole = (...roles: string[]): RequestHandler => async (req, res, next) => {
  if (!hasRequiredRole(req.user?.role, roles)) {
    try {
      await AuditLog.create({
        actor: req.user?.id,
        action: "denied",
        resource: req.originalUrl.split("?")[0].replace(/[a-f\d]{24}/gi, ":id").slice(0, 250),
        ip: req.ip,
        userAgent: req.get("user-agent")
      });
    } catch (error) {
      return next(error);
    }
    return res.status(403).json({ error: { code: "FORBIDDEN", message_en: "You do not have permission to perform this action.", message_te: "ఈ చర్యకు మీకు అనుమతి లేదు.", message_hi: "आपको यह कार्रवाई करने की अनुमति లేదు." } });
  }
  next();
};
