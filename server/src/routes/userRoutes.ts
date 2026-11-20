import { Router } from "express";
import { me } from "../controllers/userController.js";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";
export const userRoutes = Router();
userRoutes.get("/me", auth, auditAccess, me);
