import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ashaActivityReport, ashaCampParticipants, ashaDashboard, ashaPatientHistory, assignedAshaPatients, grantAshaScreeningConsent, recordAshaVisit, registerAshaPatient } from "../controllers/ashaController.js";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { requireRole } from "../middleware/rbac.js";
import { validateMongoIdParams } from "../middleware/validate.js";

export const ashaRoutes = Router();
const writeLimit = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false });

ashaRoutes.use(auth, requireRole("asha_worker"), auditAccess, validateMongoIdParams);
ashaRoutes.get("/dashboard", ashaDashboard);
ashaRoutes.get("/patients", assignedAshaPatients);
ashaRoutes.post("/patients", writeLimit, registerAshaPatient);
ashaRoutes.post("/patients/:patientId/screening-consent", writeLimit, grantAshaScreeningConsent);
ashaRoutes.get("/patients/:patientId/history", ashaPatientHistory);
ashaRoutes.post("/patients/:patientId/visits", writeLimit, recordAshaVisit);
ashaRoutes.get("/camps/:campId/participants", ashaCampParticipants);
ashaRoutes.get("/activity-report", ashaActivityReport);
