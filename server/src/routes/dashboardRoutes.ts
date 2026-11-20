import { Router } from "express";
import { auth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { auditAccess } from "../middleware/auditAccess.js";
import {
  dashboardAsha,
  dashboardDataQuality,
  dashboardExport,
  dashboardHotspots,
  dashboardSummary,
  dashboardVillageCoverage
} from "../controllers/dashboardController.js";

export const dashboardRoutes = Router();
dashboardRoutes.use(auth, auditAccess, requireRole("district_admin", "system_admin"));
dashboardRoutes.get("/dashboard/summary", dashboardSummary);
dashboardRoutes.get("/dashboard/hotspots", dashboardHotspots);
dashboardRoutes.get("/dashboard/village-coverage", dashboardVillageCoverage);
dashboardRoutes.get("/dashboard/data-quality", dashboardDataQuality);
dashboardRoutes.get("/dashboard/asha/:id", dashboardAsha);
dashboardRoutes.get("/dashboard/export", dashboardExport);
