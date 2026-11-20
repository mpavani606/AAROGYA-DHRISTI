import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { requestMetrics } from "./middleware/requestMetrics.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { hospitalManagerRoutes } from "./routes/hospitalManagerRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { adminRoutes } from "./routes/adminRoutes.js";
import { geoRoutes } from "./routes/geoRoutes.js";
import { patientRoutes } from "./routes/patientRoutes.js";
import { medicalRecordRoutes } from "./routes/medicalRecordRoutes.js";
import { phase6Routes } from "./routes/phase6Routes.js";
import { doctorRoutes } from "./routes/doctorRoutes.js";
import { prescriptionRoutes } from "./routes/prescriptionRoutes.js";
import { facilityDirectoryRoutes } from "./routes/facilityDirectoryRoutes.js";
import { phase8Routes } from "./routes/phase8Routes.js";
import { syncRoutes } from "./routes/syncRoutes.js";
import { educationRoutes } from "./routes/educationRoutes.js";
import { assistantRoutes } from "./routes/assistantRoutes.js";
import { dashboardRoutes } from "./routes/dashboardRoutes.js";
import { phase7Routes } from "./routes/phase7Routes.js";
import { analyticsRoutes } from "./routes/analyticsRoutes.js";
import { communityRoutes } from "./routes/communityRoutes.js";
import { ashaRoutes } from "./routes/ashaRoutes.js";
import { logger } from "./services/logger.js";
import { openApiDocument } from "./openapi.js";

export const app = express();
if (env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org", "https://res.cloudinary.com"],
      connectSrc: ["'self'", "https://api.openai.com", "wss://api.openai.com"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'self'", "https://meet.jit.si", "https://*.daily.co"],
      upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
const configuredOrigins = env.CLIENT_URL.split(",").map((origin) => origin.trim()).filter(Boolean);
const localDevelopmentOrigins = env.NODE_ENV === "production"
  ? []
  : ["http://localhost:5173", "http://127.0.0.1:5173"];
const allowedOrigins = new Set([...configuredOrigins, ...localDevelopmentOrigins]);
const isLocalViteOrigin = (origin: string) => {
  if (env.NODE_ENV === "production") return false;
  try {
    const url = new URL(origin);
    const isLoopbackHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const port = Number(url.port);
    return url.protocol === "http:" && isLoopbackHost && Number.isInteger(port) && port >= 5173 && port <= 5199;
  } catch {
    return false;
  }
};
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || isLocalViteOrigin(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Device-Id", "X-Request-Id"]
}));
app.use(requestId);
app.use(requestMetrics);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(mongoSanitize());
app.use(hpp());
app.use("/api/v1", rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
app.use((req, res, next) => {
  res.on("finish", () => logger.info({
    requestId: res.getHeader("x-request-id"),
    method: req.method,
    path: req.path.replace(/[a-f\d]{24}/gi, ":id"),
    statusCode: res.statusCode
  }, "request completed"));
  next();
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, { explorer: false }));
app.get("/api-docs.json", (_req, res) => res.json(openApiDocument));
app.use("/api/v1/health", healthRoutes);
app.use("/api/v1", analyticsRoutes);
app.use("/api/v1/community", communityRoutes);
app.use("/api/v1/asha", ashaRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/hospital-manager", hospitalManagerRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/geo", geoRoutes);
app.use("/api/v1/patients", patientRoutes);
app.use("/api/v1", medicalRecordRoutes);
app.use("/api/v1", phase6Routes);
app.use("/api/v1", phase8Routes);
app.use("/api/v1", doctorRoutes);
app.use("/api/v1", prescriptionRoutes);
app.use("/api/v1", facilityDirectoryRoutes);
app.use("/api/v1", phase7Routes);
app.use("/api/v1", syncRoutes);
app.use("/api/v1/education", educationRoutes);
app.use("/api/v1", assistantRoutes);
app.use("/api/v1", dashboardRoutes);
app.use(errorHandler);
