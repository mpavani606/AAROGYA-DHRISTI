import type { RequestHandler } from "express";
import { Appointment } from "../models/Appointment.js";
import { VideoSession } from "../models/VideoSession.js";
import { Patient } from "../models/Patient.js";
import { patientIsAssigned, patientIsWithinDistrict } from "./patientCareRelationship.js";

export const requireAppointmentCareRelationship: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required." } });
    if (req.user.role === "system_admin") return next();

    if (req.body.patientId) {
      const patient = await Patient.findById(String(req.body.patientId)).select("createdBy mandal mandalId phcId villageId habitationId");
      if (patient && (patientIsAssigned(patient, req.user) || await patientIsWithinDistrict(patient, req.user))) return next();
      return res.status(patient ? 403 : 404).json({ error: { code: patient ? "RELATIONSHIP_REQUIRED" : "NOT_FOUND", message_en: patient ? "A care relationship is required." : "Patient not found." } });
    }

    const appointmentId = String(req.body.appointmentId ?? req.params.id ?? "");
    let appointment = await Appointment.findById(appointmentId).select("patient clinician");
    if (!appointment && req.path.includes("/video/rooms/")) {
      const session = await VideoSession.findById(appointmentId).select("appointment");
      if (session) appointment = await Appointment.findById(session.appointment).select("patient clinician");
    }
    if (!appointment) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Appointment not found." } });
    if (appointment.clinician.toString() === req.user.id) return next();
    const patient = await Patient.findById(appointment.patient).select("createdBy mandal mandalId phcId villageId habitationId");
    if (!patient || (!patientIsAssigned(patient, req.user) && !await patientIsWithinDistrict(patient, req.user))) return res.status(403).json({ error: { code: "RELATIONSHIP_REQUIRED", message_en: "A care relationship is required." } });
    next();
  } catch (error) {
    next(error);
  }
};
