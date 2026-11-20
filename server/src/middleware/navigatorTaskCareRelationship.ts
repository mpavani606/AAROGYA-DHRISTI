import type { RequestHandler } from "express";
import { NavigatorTask } from "../models/NavigatorTask.js";
import { Patient } from "../models/Patient.js";
import { patientIsAssigned } from "./patientCareRelationship.js";

export const requireNavigatorTaskCareRelationship: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required." } });
    if (req.user.role === "system_admin") return next();
    const task = await NavigatorTask.findById(req.params.id).select("patient");
    if (!task) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Navigator task not found." } });
    const patient = await Patient.findById(task.patient).select("createdBy mandalId phcId villageId habitationId");
    if (!patient || !patientIsAssigned(patient, req.user)) return res.status(403).json({ error: { code: "RELATIONSHIP_REQUIRED", message_en: "A care relationship is required." } });
    next();
  } catch (error) {
    next(error);
  }
};
