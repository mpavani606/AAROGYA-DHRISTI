import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, logout, register, registerDoctor, registerPatient, refresh, setupMfa, verifyMfa, requestPatientOtp, verifyPatientOtp, setupManagerPassword, setupAshaWorkerPassword } from "../controllers/authController.js";
import { auth } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";
import { auditAccess } from "../middleware/auditAccess.js";
import { validate, registerSchema, doctorRegisterSchema, loginSchema, mfaSchema, mfaSetupSchema, refreshSchema, patientOtpRequestSchema, patientOtpVerifySchema, patientRegisterSchema, managerPasswordSetupSchema } from "../middleware/validate.js";
import { env } from "../config/env.js";
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many login attempts." } }
});
const mfaLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many verification attempts." } }
});
const refreshLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  skipSuccessfulRequests: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many session refresh attempts." } }
});
const setupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many password setup attempts." } }
});
const mfaSetupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many MFA setup attempts." } }
});
const registrationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many registration attempts." } }
});
const doctorRegistrationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many doctor registration attempts. Please wait before trying again." } }
});
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === "development" ? 30 : 5,
  standardHeaders: true,
  message: { error: { code: "RATE_LIMITED", message_en: "Too many verification requests. Please wait before requesting another code." } }
});
export const authRoutes = Router();
authRoutes.post("/register", registrationLimiter, validate(registerSchema), auditAccess, audit("register", "auth"), register);
authRoutes.post("/doctor/register", doctorRegistrationLimiter, validate(doctorRegisterSchema), auditAccess, audit("doctor.register", "auth"), registerDoctor);
authRoutes.post("/login", loginLimiter, validate(loginSchema), auditAccess, audit("login", "auth"), login);
authRoutes.post("/hospital-manager/password-setup", setupLimiter, validate(managerPasswordSetupSchema), setupManagerPassword);
authRoutes.post("/asha-worker/password-setup", setupLimiter, validate(managerPasswordSetupSchema), setupAshaWorkerPassword);
authRoutes.post("/mfa/verify", mfaLimiter, validate(mfaSchema), auditAccess, verifyMfa);
authRoutes.post("/refresh", refreshLimiter, validate(refreshSchema), auditAccess, refresh);
authRoutes.post("/logout", auth, auditAccess, audit("logout", "auth"), logout);
authRoutes.post("/mfa/setup", mfaSetupLimiter, validate(mfaSetupSchema), auditAccess, setupMfa);
authRoutes.post("/patient/register", registrationLimiter, validate(patientRegisterSchema), auditAccess, audit("register_patient", "auth"), registerPatient);
authRoutes.post("/patient/otp/request", otpRequestLimiter, validate(patientOtpRequestSchema), auditAccess, requestPatientOtp);
authRoutes.post("/patient/otp/verify", mfaLimiter, validate(patientOtpVerifySchema), auditAccess, verifyPatientOtp);
