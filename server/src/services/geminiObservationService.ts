import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { CaseImage } from "../models/CaseImage.js";
import { Consent } from "../models/Consent.js";
import { GeminiScreeningObservation } from "../models/GeminiScreeningObservation.js";
import { env } from "../config/env.js";
import { assessScreeningImageWithGemini } from "./geminiScreeningService.js";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

export async function createGeminiScreeningObservation(
  caseId: string,
  image: InstanceType<typeof CaseImage>,
  actorId: string,
  imageBuffer: Buffer
) {
  if (!objectIdSchema.safeParse(caseId).success || !objectIdSchema.safeParse(actorId).success) {
    throw Object.assign(new Error("Invalid screening reference."), { status: 400, code: "INVALID_SCREENING_REFERENCE" });
  }
  const consent = await Consent.findOne({
    patient: image.patient,
    purpose: "external_ai",
    granted: true,
    consentVersion: "gemini-screening-v1",
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
  }).select("consentVersion");
  if (!consent) return { status: "consent_required" as const };
  if (!env.GEMINI_API_KEY) return { status: "provider_unavailable" as const };

  const existing = await GeminiScreeningObservation.findOne({ image: image._id, provider: "gemini" });
  if (existing) return { status: "completed" as const, observation: existing };

  const result = await assessScreeningImageWithGemini(imageBuffer, image.mimeType);
  let observation;
  try {
    observation = await GeminiScreeningObservation.create({
      case: caseId,
      patient: image.patient,
      image: image._id,
      provider: "gemini",
      model: env.GEMINI_MODEL,
      imageQuality: result.imageQuality,
      visibleDescription: result.visibleDescription,
      consentVersion: consent.consentVersion
    });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    observation = await GeminiScreeningObservation.findOne({ image: image._id, provider: "gemini" });
    if (!observation) throw error;
  }
  await AuditLog.create({
    actor: actorId,
    action: "gemini_screening_observation_created",
    resource: "GeminiScreeningObservation",
    resourceId: observation._id.toString(),
    metadata: { model: env.GEMINI_MODEL, consentVersion: consent.consentVersion }
  });
  return { status: "completed" as const, observation };
}
