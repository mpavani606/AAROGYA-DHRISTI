import { Router } from "express";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { requirePatientCareRelationship } from "../middleware/patientCareRelationship.js";
import { requireRole } from "../middleware/rbac.js";
import { requireDoctorVerification } from "../middleware/doctorVerification.js";
import { validateMongoIdParams } from "../middleware/validate.js";
import {
  downloadPrescriptionPdf,
  prescriptionDashboard,
  prescriptionDetails,
  updatePrescriptionStatus,
  voidPrescription
} from "../controllers/prescriptionController.js";
import { createPatientPrescription } from "../controllers/doctorController.js";
import { createMedicine, deleteMedicine, listMedicines, updateMedicine } from "../controllers/medicineController.js";

export const prescriptionRoutes = Router();
const prescriptionAccess = [auth, auditAccess, requireRole("doctor"), requireDoctorVerification, validateMongoIdParams];

prescriptionRoutes.get("/medicines", ...prescriptionAccess, listMedicines);
prescriptionRoutes.post("/medicines", ...prescriptionAccess, createMedicine);
prescriptionRoutes.patch("/medicines/:medicineId", ...prescriptionAccess, updateMedicine);
prescriptionRoutes.delete("/medicines/:medicineId", ...prescriptionAccess, deleteMedicine);
prescriptionRoutes.get("/prescriptions", ...prescriptionAccess, prescriptionDashboard);
prescriptionRoutes.post("/prescriptions", ...prescriptionAccess, requirePatientCareRelationship, createPatientPrescription);
prescriptionRoutes.get("/prescriptions/:prescriptionId/pdf", ...prescriptionAccess, downloadPrescriptionPdf);
prescriptionRoutes.get("/prescriptions/:prescriptionId", ...prescriptionAccess, prescriptionDetails);
prescriptionRoutes.patch(
  "/patients/:patientId/prescriptions/:prescriptionId/status",
  ...prescriptionAccess,
  requirePatientCareRelationship,
  updatePrescriptionStatus
);
prescriptionRoutes.delete(
  "/patients/:patientId/prescriptions/:prescriptionId",
  ...prescriptionAccess,
  requirePatientCareRelationship,
  voidPrescription
);
