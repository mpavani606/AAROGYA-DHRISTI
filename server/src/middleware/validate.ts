import type { RequestHandler } from "express";
import { z, type ZodTypeAny } from "zod";

const mongoIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const uuidSchema = z.string().uuid();

export const validate = (schema: ZodTypeAny): RequestHandler => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Please check the provided values.", details: result.error.flatten() } });
  req.body = result.data; next();
};

export const validateMongoIdParams: RequestHandler = (req, res, next) => {
  const invalid = Object.entries(req.params).some(([key, value]) =>
    (key === "id" || key.endsWith("Id")) && key !== "uploadId" && !mongoIdSchema.safeParse(value).success
  );
  if (invalid) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "A resource identifier is invalid." } });
  next();
};

export const validateUploadIdParam: RequestHandler = (req, res, next) => {
  if (!uuidSchema.safeParse(req.params.uploadId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "The upload identifier is invalid." } });
  }
  next();
};

export const registerSchema = z.object({ phone: z.string().min(7), password: z.string().min(8), name: z.string().min(2).max(100), email: z.string().email().optional(), otp: z.string().optional(), locale: z.enum(["en", "te", "hi"]).optional() });
export const doctorRegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(7).max(20),
  password: z.string().min(12).max(128),
  registrationNo: z.string().trim().min(2).max(80),
  registrationAuthority: z.string().trim().min(2).max(160),
  specialty: z.string().trim().min(2).max(120),
  hospitalName: z.string().trim().min(2).max(160),
  qualification: z.string().trim().min(2).max(200),
  experienceYears: z.coerce.number().int().min(0).max(70)
}).strict();
export const loginSchema = z.object({ identifier: z.string().trim().min(3).max(254).optional(), phone: z.string().min(7).optional(), email: z.string().email().optional(), password: z.string().min(1), role: z.enum(["patient", "doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"]).optional(), hospitalCode: z.string().trim().min(2).max(50).optional() })
  .refine((value) => Boolean(value.identifier || value.phone || value.email), "Phone, email, or username is required")
  .refine((value) => value.role !== "hospital_manager" || Boolean(value.hospitalCode), "Hospital ID is required for manager sign-in");
export const managerPasswordSetupSchema = z.object({ token: z.string().min(32).max(200), password: z.string().min(12).max(128) }).strict();
export const patientOtpRequestSchema = z.object({ phone: z.string().trim().min(7).max(20) }).strict();
export const patientOtpVerifySchema = z.object({ challengeId: z.string().regex(/^[a-f\d]{24}$/i), code: z.string().regex(/^\d{6}$/) }).strict();
export const patientRegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(20),
  age: z.coerce.number().int().min(0).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().refine((value) => {
    if (!value) return true;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
  }),
  address: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(3).max(200).optional()
  ),
  district: z.string().trim().min(2).max(100),
  mandal: z.string().trim().min(1).max(100).default("Paderu"),
  village: z.string().trim().min(1).max(100),
  preferredLanguage: z.enum(["en", "te", "hi"]).optional(),
  consent: z.literal(true)
}).strict();
export const mfaSchema = z.object({ mfaToken: z.string().min(1), code: z.string().regex(/^\d{6}$/) });
export const mfaSetupSchema = z.object({ mfaToken: z.string().min(1) });
export const refreshSchema = z.object({ refreshToken: z.string().optional() });
