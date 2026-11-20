import type { RequestHandler } from "express";
import { Case } from "../models/Case.js";
import { Appointment } from "../models/Appointment.js";
import { Patient } from "../models/Patient.js";
import { patientIsAssigned, patientIsWithinDistrict } from "./patientCareRelationship.js";

export const requireCaseCareRelationship: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required." } });
    if (req.user.role === "system_admin") return next();
    const caseId = String(req.params.id ?? req.params.caseId ?? req.body.caseId ?? "");
    const item = await Case.findById(caseId).select("patient");
    if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Case not found." } });
    const patient = await Patient.findById(item.patient).select("createdBy mandal phoneHash mandalId phcId villageId habitationId");
    if (!patient) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Patient not found." } });
    const assigned = patientIsAssigned(patient, req.user) || await patientIsWithinDistrict(patient, req.user);
    const appointment = req.user.role === "doctor" && await Appointment.exists({ case: item._id, clinician: req.user.id, status: { $ne: "cancelled" } });
    if (!assigned && !appointment) return res.status(403).json({ error: { code: "RELATIONSHIP_REQUIRED", message_en: "A care relationship is required.", message_te: "సంరక్షణ సంబంధం అవసరం.", message_hi: "देखभाल संबंध आवश्यक है।" } });
    next();
  } catch (error) {
    next(error);
  }
};
