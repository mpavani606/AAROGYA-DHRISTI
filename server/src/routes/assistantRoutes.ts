import { Router } from "express";
import rateLimit from "express-rate-limit";
import { assistantChat, createRealtimeSession, ragSearch, searchMedicalKnowledge } from "../controllers/assistantController.js";
import { auth } from "../middleware/auth.js";
import { auditAccess } from "../middleware/auditAccess.js";

const aiLimit = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false });
export const assistantRoutes = Router();
assistantRoutes.use(auth, auditAccess);
assistantRoutes.post("/rag/search", aiLimit, ragSearch);
assistantRoutes.post("/ai/tool/search_medical_knowledge", aiLimit, searchMedicalKnowledge);
assistantRoutes.post("/ai/chat", aiLimit, assistantChat);
assistantRoutes.post("/ai/realtime/session", rateLimit({ windowMs: 60_000, limit: 4, standardHeaders: true, legacyHeaders: false }), createRealtimeSession);
