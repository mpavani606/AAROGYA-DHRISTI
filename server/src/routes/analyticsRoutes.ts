import { Router } from "express";
import { aiOperationsMonitoring, analyticsOverview, detailedSystemHealth, operationalReport } from "../controllers/analyticsController.js";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { requireDoctorVerification } from "../middleware/doctorVerification.js";
import { requireRole } from "../middleware/rbac.js";

export const analyticsRoutes = Router();
analyticsRoutes.get("/analytics/overview", auth, auditAccess, requireRole("system_admin", "district_admin", "hospital_manager", "doctor"), requireDoctorVerification, analyticsOverview);
analyticsRoutes.get("/ai-monitoring", auth, auditAccess, requireRole("system_admin"), aiOperationsMonitoring);
analyticsRoutes.get("/system-health", auth, auditAccess, requireRole("system_admin"), detailedSystemHealth);
analyticsRoutes.get("/operational-reports", auth, auditAccess, requireRole("system_admin", "district_admin", "hospital_manager", "doctor"), requireDoctorVerification, operationalReport);
