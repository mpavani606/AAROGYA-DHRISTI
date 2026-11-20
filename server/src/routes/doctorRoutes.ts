import { Router, type RequestHandler } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { auth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { validateMongoIdParams } from "../middleware/validate.js";
import { requireDoctorCaseCareRelationship } from "../middleware/doctorCaseCareRelationship.js";
import { requirePatientCareRelationship } from "../middleware/patientCareRelationship.js";
import { reviewQueue, clinicalSummary, reviewCase, recaptureRequest, signReview, createReferral, updateReferral, createInvestigation, updateInvestigation, createReport, createDiagnosis, caseInvestigations, patientPrescriptions, createPatientPrescription, doctorAvailability, addOwnDoctorAvailability, removeOwnDoctorAvailability, doctorProfile, updateDoctorProfile, uploadDoctorDocument, submitDoctorProfile, downloadDoctorDocument, slaRules } from "../controllers/doctorController.js";
import { requireDoctorVerification } from "../middleware/doctorVerification.js";
import { requireActiveScreeningConsent } from "../middleware/consent.js";

export const doctorRoutes = Router();
const professionalUploadLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const doctorAccess: RequestHandler[] = [auth, auditAccess, requireRole("doctor"), validateMongoIdParams];
const verifiedDoctorAccess: RequestHandler[] = [...doctorAccess, requireDoctorVerification];
const professionalUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error("Only PDF, JPG, and PNG documents are allowed."), { status: 400, code: "INVALID_FILE_TYPE" }));
  }
});
doctorRoutes.get("/doctor-profile", ...doctorAccess, doctorProfile);
doctorRoutes.patch("/doctor-profile", ...doctorAccess, updateDoctorProfile);
doctorRoutes.post("/doctor-profile/documents", ...doctorAccess, professionalUploadLimit, professionalUpload.single("file"), uploadDoctorDocument);
doctorRoutes.post("/doctor-profile/submit", ...doctorAccess, submitDoctorProfile);
doctorRoutes.get("/doctor-profile/documents/:documentId", ...doctorAccess, downloadDoctorDocument);
doctorRoutes.get("/doctor/availability", ...verifiedDoctorAccess, doctorAvailability);
doctorRoutes.post("/doctor/availability", ...verifiedDoctorAccess, addOwnDoctorAvailability);
doctorRoutes.delete("/doctor/availability/:slotId", ...verifiedDoctorAccess, removeOwnDoctorAvailability);
doctorRoutes.get("/patients/:patientId/prescriptions", ...verifiedDoctorAccess, requirePatientCareRelationship, patientPrescriptions);
doctorRoutes.post("/patients/:patientId/prescriptions", ...verifiedDoctorAccess, requirePatientCareRelationship, createPatientPrescription);
doctorRoutes.get("/review/queue", ...verifiedDoctorAccess, reviewQueue);
doctorRoutes.get("/cases/:id/clinical-summary", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, requireActiveScreeningConsent, clinicalSummary);
doctorRoutes.get("/cases/:id/investigations", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, caseInvestigations);
doctorRoutes.post("/cases/:id/review", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, reviewCase);
doctorRoutes.post("/cases/:id/recapture-request", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, recaptureRequest);
doctorRoutes.post("/cases/:id/sign", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, signReview);
doctorRoutes.post("/cases/:id/referrals", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, createReferral);
doctorRoutes.post("/referrals", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, createReferral);
doctorRoutes.patch("/referrals/:id/status", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, updateReferral);
doctorRoutes.post("/cases/:id/investigations", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, createInvestigation);
doctorRoutes.post("/investigations", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, createInvestigation);
doctorRoutes.patch("/investigations/:id/status", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, updateInvestigation);
doctorRoutes.post("/investigations/:id/report", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, createReport);
doctorRoutes.post("/cases/:id/diagnosis", ...verifiedDoctorAccess, requireDoctorCaseCareRelationship, createDiagnosis);
doctorRoutes.get("/sla-rules", ...verifiedDoctorAccess, slaRules);
