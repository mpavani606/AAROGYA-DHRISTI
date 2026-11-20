import { Router } from "express";
import { getFacilityDirectoryDetail, searchFacilityDirectory } from "../controllers/facilityDirectoryController.js";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { requireRole } from "../middleware/rbac.js";

export const facilityDirectoryRoutes = Router();
facilityDirectoryRoutes.get(
  "/facility-directory",
  auth,
  requireRole("patient", "doctor"),
  auditAccess,
  searchFacilityDirectory
);
facilityDirectoryRoutes.get(
  "/facility-directory/:facilityId",
  auth,
  requireRole("patient", "doctor"),
  auditAccess,
  getFacilityDirectoryDetail
);
