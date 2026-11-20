import { Router } from "express";
import { createEducationPage, educationAudio, educationPage, educationPages, foodItems, managedPages, publishEducationPage, reviewEducationPage, updateEducationPage } from "../controllers/educationController.js";
import { auth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { auditAccess } from "../middleware/auditAccess.js";

export const educationRoutes = Router();
educationRoutes.get("/pages", auditAccess, educationPages);
educationRoutes.get("/pages/:slug/audio", auditAccess, educationAudio);
educationRoutes.get("/pages/:slug", auditAccess, educationPage);
educationRoutes.get("/foods", auditAccess, foodItems);
educationRoutes.use("/manage", auth, auditAccess, requireRole("doctor"));
educationRoutes.get("/manage/pages", managedPages);
educationRoutes.post("/manage/pages", createEducationPage);
educationRoutes.patch("/manage/pages/:id", updateEducationPage);
educationRoutes.post("/manage/pages/:id/review", reviewEducationPage);
educationRoutes.post("/manage/pages/:id/publish", publishEducationPage);
