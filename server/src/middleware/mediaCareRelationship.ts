import type { RequestHandler } from "express";
import { MediaObject } from "../models/MediaObject.js";
import { Patient } from "../models/Patient.js";
import { patientIsAssigned, patientIsWithinDistrict } from "./patientCareRelationship.js";

export const requireMediaCareRelationship: RequestHandler = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required." } });
  const media = await MediaObject.findById(req.params.id).select("patient");
  if (!media) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Media not found." } });
  try {
    if (req.user.role === "system_admin") return next();
    const patient = await Patient.findById(media.patient).select("createdBy phoneHash mandal mandalId phcId villageId habitationId");
    if (!patient || (!patientIsAssigned(patient, req.user) && !await patientIsWithinDistrict(patient, req.user))) return res.status(403).json({ error: { code: "RELATIONSHIP_REQUIRED", message_en: "A care relationship is required.", message_te: "సంరక్షణ సంబంధం అవసరం.", message_hi: "देखभाल संबंध आवश्यक है।" } });
    next();
  } catch (error) {
    next(error);
  }
};
