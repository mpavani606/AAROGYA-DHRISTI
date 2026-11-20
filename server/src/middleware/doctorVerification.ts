import type { RequestHandler } from "express";
import { DoctorProfile } from "../models/DoctorProfile.js";

export const requireDoctorVerification: RequestHandler = async (req, res, next) => {
  if (req.user?.role !== "doctor") return next();
  if (req.path === "/doctor-profile" || req.path.startsWith("/doctor-profile/")) return next();
  try {
    if (await DoctorProfile.exists({ user: req.user.id, $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }] })) return next();
    return res.status(403).json({ error: { code: "DOCTOR_VERIFICATION_REQUIRED", message_en: "Professional verification must be completed before using clinical workflows." } });
  } catch (error) {
    next(error);
  }
};
