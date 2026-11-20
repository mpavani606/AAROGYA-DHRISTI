import { Router } from "express";
import multer from "multer";
import { auth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { auditAccess } from "../middleware/auditAccess.js";
import rateLimit from "express-rate-limit";
import { requirePatientCareRelationship } from "../middleware/patientCareRelationship.js";
import { requireMediaCareRelationship } from "../middleware/mediaCareRelationship.js";
import { requireDoctorVerification } from "../middleware/doctorVerification.js";
import { validateMongoIdParams } from "../middleware/validate.js";
import { createMedicalRecord, downloadLocalMedia, getMediaSignedUrl, patientTimeline } from "../controllers/medicalRecordController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error("Only PDF, JPG, and PNG files are allowed."), { status: 400, code: "INVALID_FILE_TYPE" }));
  }
});
export const medicalRecordRoutes = Router();
medicalRecordRoutes.get("/media/:id/signed-url", auth, requireRole("patient", "doctor", "district_admin", "system_admin"), requireDoctorVerification, auditAccess, validateMongoIdParams, requireMediaCareRelationship, getMediaSignedUrl);
medicalRecordRoutes.get("/media/*", downloadLocalMedia);
medicalRecordRoutes.use(auth, requireRole("patient", "doctor", "district_admin", "system_admin"), requireDoctorVerification, auditAccess, validateMongoIdParams);
const uploadLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
medicalRecordRoutes.post("/patients/:id/records", uploadLimit, requirePatientCareRelationship, upload.single("file"), createMedicalRecord);
medicalRecordRoutes.get("/patients/:id/timeline", requirePatientCareRelationship, patientTimeline);
