import type { RequestHandler } from "express";
import { Appointment } from "../models/Appointment.js";
import { Case } from "../models/Case.js";
import { Investigation } from "../models/Investigation.js";
import { Patient } from "../models/Patient.js";
import { Referral } from "../models/Referral.js";
import { patientIsAssigned } from "./patientCareRelationship.js";

export const requireDoctorCaseCareRelationship: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required." } });
    const referralRoute = req.path.startsWith("/referrals/");
    const investigationRoute = req.path.startsWith("/investigations/");
    let caseId = referralRoute || investigationRoute ? undefined : req.params.id ?? req.params.caseId ?? req.body.caseId;
    if (referralRoute) caseId = (await Referral.findById(req.params.id).select("case"))?.case?.toString();
    if (investigationRoute) caseId = (await Investigation.findById(req.params.id).select("case"))?.case?.toString();
    if (!caseId) return res.status(400).json({ error: { code: "CASE_REQUIRED", message_en: "A case reference is required." } });

    const item = await Case.findById(caseId).select("patient");
    if (!item) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Case not found." } });
    const patient = await Patient.findById(item.patient).select("createdBy mandalId phcId habitationId mandal");
    if (!patient) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Patient not found." } });

    const assigned = patientIsAssigned(patient, req.user);
    const appointment = req.user.role === "doctor" && await Appointment.exists({
      clinician: req.user.id,
      patient: patient._id,
      $or: [{ case: item._id }, { case: { $exists: false } }],
      status: { $ne: "cancelled" }
    });
    if (!assigned && !appointment) return res.status(403).json({ error: { code: "RELATIONSHIP_REQUIRED", message_en: "A care relationship is required." } });
    next();
  } catch (error) {
    next(error);
  }
};
