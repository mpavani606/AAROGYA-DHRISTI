import type { RequestHandler } from "express";
import { User } from "../models/User.js";
export const requireCareRelationship: RequestHandler = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required." } });
  if (req.params.userId === req.user.id) return next();
  const target = await User.exists({ _id: req.params.userId, "relationships.user": req.user.id });
  if (!target && !["doctor", "district_admin", "system_admin"].includes(req.user.role)) return res.status(403).json({ error: { code: "RELATIONSHIP_REQUIRED", message_en: "A care relationship is required.", message_te: "సంరక్షణ సంబంధం అవసరం.", message_hi: "देखभाल संबंध आवश्यक है।" } });
  next();
};
