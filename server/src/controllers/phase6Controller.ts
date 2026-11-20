import type { RequestHandler } from "express";
import fs from "node:fs/promises";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { Case } from "../models/Case.js";
import { CaseImage } from "../models/CaseImage.js";
import { GeminiScreeningObservation } from "../models/GeminiScreeningObservation.js";
import { Habit } from "../models/Habit.js";
import { Symptom } from "../models/Symptom.js";
import { AiModel } from "../models/AiModel.js";
import { AiInference } from "../models/AiInference.js";
import { AuditLog } from "../models/AuditLog.js";
import { CessationPlan } from "../models/CessationPlan.js";
import { Patient } from "../models/Patient.js";
import { processUpload, hashBuffer, localFile, saveLocal } from "../services/mediaService.js";
import { encryptBuffer, decryptBuffer } from "../services/encryption.js";
import { qualityCheck, riskScore } from "../services/aiService.js";
import { inferPersistedImage } from "../services/screeningService.js";
import { createGeminiScreeningObservation } from "../services/geminiObservationService.js";
import { queueWorkflowNotification } from "../services/workflowNotificationService.js";
import { logger } from "../services/logger.js";

const error = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) =>
  res.status(status).json({ error: { code, message_en, message_te: "చెల్లని అభ్యర్థన.", message_hi: "अमान्य अनुरोध।" } });
const ensureCase = async (id: string) => Case.findById(id);
const ensurePatient = async (id: string) => Patient.findOne({ _id: id, active: true });

export const createCase: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ patientId: z.string().regex(/^[a-f\d]{24}$/i), notes: z.string().max(10000).optional() }).strict().parse(req.body);
    const patientId = body.patientId;
    if (!await ensurePatient(patientId)) return error(res, "NOT_FOUND", "Patient not found.", 404);
    const status = req.user!.role === "patient" ? "submitted" : "draft";
    const result = await Case.create({ patient: patientId, notes: body.notes, status, createdBy: req.user!.id });
    if (status === "submitted") await queueWorkflowNotification({ eventKey: `screening:${result._id}`, patientId, actorId: req.user!.id, template: "screening_submitted" });
    res.status(201).json({ case: result });
  } catch (e) { next(e); }
};
export const addCaseImage: RequestHandler = async (req, res, next) => {
  try {
    const item = await ensureCase(String(req.params.id));
    if (!item) return error(res, "NOT_FOUND", "Case not found.", 404);
    if (!req.file) return error(res, "FILE_REQUIRED", "An image is required.");
    const processed = await processUpload(req.file.buffer, req.file.mimetype);
    const key = `cases/${item._id}/${hashBuffer(processed.buffer)}.jpg`;
    await saveLocal(encryptBuffer(processed.buffer), key);
    const quality = await qualityCheck(processed.buffer);
    const image = await CaseImage.findOneAndUpdate(
      { storageKey: key },
      { $setOnInsert: { case: item._id, patient: item.patient, originalName: req.file.originalname, mimeType: "image/jpeg", size: processed.buffer.length, storageKey: key, width: processed.width, height: processed.height, sha256: hashBuffer(processed.buffer), qualityStatus: quality.pass ? "usable" : "insufficient", encryptedAtRest: true } },
      { upsert: true, new: true }
    );
    let aiProcessingStatus = "completed";
    try { await inferPersistedImage(item._id.toString(), image, req.user!.id); }
    catch (error) {
      aiProcessingStatus = "AI_PROCESSING_UNAVAILABLE";
      logger.error({ code: error instanceof Error ? error.name : "AI_PROCESSING_ERROR" }, "Demonstration screening inference failed; image remains available for doctor review");
    }
    let geminiObservation: Awaited<ReturnType<typeof createGeminiScreeningObservation>> | { status: "unavailable" } = { status: "consent_required" };
    try { geminiObservation = await createGeminiScreeningObservation(item._id.toString(), image, req.user!.id, processed.buffer); }
    catch (error) {
      geminiObservation = { status: "unavailable" };
      logger.error({ code: error instanceof Error && "code" in error ? error.code : "GEMINI_ASSESSMENT_FAILED" }, "Consented Gemini observation could not be completed");
    }
    if (item.status === "draft") {
      item.status = "submitted";
      await item.save();
      await queueWorkflowNotification({ eventKey: `screening:${item._id}`, patientId: item.patient.toString(), actorId: req.user!.id, template: "screening_submitted" });
    }
    res.status(201).json({
      image,
      aiProcessingStatus,
      geminiObservation: geminiObservation.status === "completed" ? {
        status: geminiObservation.status,
        imageQuality: geminiObservation.observation.imageQuality,
        visibleDescription: geminiObservation.observation.visibleDescription,
        model: geminiObservation.observation.model,
        processedAt: geminiObservation.observation.createdAt
      } : { status: geminiObservation.status },
      disclaimer: "Gemini provides only an unvalidated visual observation, not a medical diagnosis or risk assessment. A qualified healthcare professional must independently review the image."
    });
  } catch (e) { next(e); }
};
export const caseImages: RequestHandler = async (req, res, next) => {
  try {
    const caseId = String(req.params.id);
    const images = await CaseImage.find({ case: caseId }).sort({ createdAt: -1 }).select("_id qualityStatus createdAt");
    const imageIds = images.map((image) => image._id);
    const [inferences, observations] = await Promise.all([
      AiInference.find({ case: caseId, image: { $in: imageIds } }).sort({ createdAt: -1 }).select("image state output metadata createdAt"),
      GeminiScreeningObservation.find({ case: caseId, image: { $in: imageIds } }).sort({ createdAt: -1 }).select("image imageQuality visibleDescription model createdAt")
    ]);
    res.json({
      images: images.map((image) => {
        const inference = inferences.find((item) => item.image?.toString() === image._id.toString());
        return {
          id: image._id.toString(),
          qualityStatus: image.qualityStatus,
          createdAt: image.createdAt,
          aiResult: inference ? {
            status: "demo_not_validated",
            clinicallyValidated: false,
            model: inference.metadata?.model ?? null,
            processedAt: inference.createdAt
          } : null,
          aiProcessingStatus: inference ? "completed" : "AI_PROCESSING_UNAVAILABLE",
          geminiObservation: (() => {
            const observation = observations.find((item) => item.image.toString() === image._id.toString());
            return observation ? {
              imageQuality: observation.imageQuality,
              visibleDescription: observation.visibleDescription,
              model: observation.model,
              processedAt: observation.createdAt
            } : null;
          })()
        };
      })
    });
  } catch (error) { next(error); }
};
export const caseImage: RequestHandler = async (req, res, next) => {
  try {
    const caseId = String(req.params.id);
    const image = await CaseImage.findOne({ _id: String(req.params.imageId), case: caseId }).select("storageKey mimeType encryptedAtRest");
    if (!image) return error(res, "NOT_FOUND", "Case image not found.", 404);
    if (!new RegExp(`^cases/${caseId}/[a-f\\d]{64}\\.jpg$`, "i").test(image.storageKey)) return error(res, "INVALID_IMAGE_STORAGE", "This case image cannot be accessed.", 500);
    const stored = await fs.readFile(localFile(image.storageKey));
    const buffer = image.encryptedAtRest ? decryptBuffer(stored) : stored;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(image.mimeType).send(buffer);
  } catch (error) { next(error); }
};
export const caseScreeningReport: RequestHandler = async (req, res, next) => {
  try {
    const caseId = String(req.params.id);
    const item = await Case.findById(caseId).select("createdAt notes");
    if (!item) return error(res, "NOT_FOUND", "Case not found.", 404);
    const latestImage = await CaseImage.findOne({ case: item._id }).sort({ createdAt: -1 }).select("storageKey mimeType encryptedAtRest qualityStatus createdAt");
    if (!latestImage) return error(res, "SCREENING_IMAGE_REQUIRED", "A screening image is required to generate this report.", 404);
    const images = [latestImage];
    const imageIds = images.map((image) => image._id);
    const [observations, inferences] = await Promise.all([
      GeminiScreeningObservation.find({ case: item._id, image: { $in: imageIds } }).sort({ createdAt: -1 }).select("image imageQuality visibleDescription model createdAt"),
      AiInference.find({ case: item._id, image: { $in: imageIds } }).sort({ createdAt: -1 }).select("image state createdAt")
    ]);
    const caseNotes = (() => {
      try {
        const parsed: unknown = JSON.parse(item.notes ?? "");
        return parsed && typeof parsed === "object" ? parsed as { site?: unknown; symptoms?: unknown } : {};
      } catch {
        return {};
      }
    })();
    const siteLabels: Record<string, string> = {
      tongue: "Tongue",
      gums: "Gums",
      innerCheek: "Inner cheek",
      lips: "Lips",
      palate: "Palate",
      floorOfMouth: "Floor of mouth",
      otherOralArea: "Other oral area"
    };
    const site = typeof caseNotes.site === "string" ? siteLabels[caseNotes.site] ?? "Not recorded" : "Not recorded";
    const symptoms = Array.isArray(caseNotes.symptoms)
      ? caseNotes.symptoms.filter((value): value is string => typeof value === "string").slice(0, 20).map((value) => ({
        cough: "Cough lasting more than two weeks",
        mouth: "Mouth sore or patch that does not heal",
        swallow: "Difficulty swallowing",
        voice: "Voice change lasting more than two weeks",
        weight: "Unexpected weight change"
      }[value] ?? value))
      : [];
    const imageBuffers = await Promise.all(images.map(async (image) => {
      if (!new RegExp(`^cases/${caseId}/[a-f\\d]{64}\\.jpg$`, "i").test(image.storageKey)) {
        throw Object.assign(new Error("This screening image cannot be accessed."), { status: 500, code: "INVALID_IMAGE_STORAGE" });
      }
      const stored = await fs.readFile(localFile(image.storageKey));
      return image.encryptedAtRest ? decryptBuffer(stored) : stored;
    }));
    await AuditLog.create({
      actor: req.user!.id,
      action: "screening_report_generated",
      resource: "Case",
      resourceId: caseId,
      metadata: { imageCount: images.length, synthetic: true }
    });
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Oral screening report", Author: "Aarogya Drishti" } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", next);
    document.on("end", () => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="oral-screening-${caseId.slice(-8)}.pdf"`);
      res.type("application/pdf").send(Buffer.concat(chunks));
    });
    document.fontSize(18).fillColor("#111827").text("Aarogya Drishti — Oral Screening Report");
    document.moveDown(0.25).fontSize(10).fillColor("#9a3412").text("PRELIMINARY SCREENING ONLY · NOT FOR CLINICAL USE · NOT A DIAGNOSIS");
    document.moveDown().fillColor("#111827").fontSize(10)
      .text(`Case reference: ${caseId}`)
      .text(`Screening date: ${item.createdAt.toISOString()}`)
      .text(`Reported oral area: ${site}`)
      .text(`Image quality: ${images.map((image) => image.qualityStatus).join(", ")}`)
      .text("Image-based risk level: Not assessed");
    document.moveDown().fontSize(13).text("Image analysis");
    images.forEach((image, index) => {
      const observation = observations.find((entry) => entry.image.toString() === image._id.toString());
      const inference = inferences.find((entry) => entry.image?.toString() === image._id.toString());
      document.fontSize(10).text(`Image ${index + 1} · ${image.createdAt.toISOString()}`);
      if (observation) {
        document.text(`Unvalidated visual observation (${observation.imageQuality}): ${observation.visibleDescription}`);
        document.text(`Provider: ${observation.model}. This observation is not a diagnosis and does not determine disease or risk.`);
      } else {
        document.text("No external visual observation is available. The configured local model is a deterministic demonstration and does not detect or rule out oral conditions.");
      }
      if (inference) document.text(`Local demonstration processing state: ${inference.state} (not clinically validated).`);
      document.moveDown(0.4);
    });
    document.addPage().fontSize(13).fillColor("#111827").text("Uploaded screening image(s)");
    imageBuffers.forEach((buffer, index) => {
      if (index > 0) document.addPage();
      document.fontSize(10).text(`Image ${index + 1} · ${images[index].createdAt.toISOString()}`).moveDown(0.5);
      document.image(buffer, { fit: [480, 610], align: "center", valign: "center" });
    });
    document.addPage().fillColor("#111827").fontSize(13).text("Reported symptoms and next steps");
    document.fontSize(10).moveDown(0.5)
      .text(`Reported symptoms: ${symptoms.length ? symptoms.join(", ") : "None recorded in this screening."}`)
      .moveDown()
      .text("This screening cannot reliably identify or exclude oral ulcers, white or red patches, oral submucous fibrosis, suspicious lesions, or other conditions. A visual description is not confirmation of a disease.")
      .moveDown()
      .text("Recommendation: Arrange an in-person examination with a qualified dentist or healthcare professional. Seek assessment promptly for a sore or patch that persists for two weeks, a growing or bleeding area, difficulty swallowing or opening the mouth, or any rapidly worsening concern. A clinician will decide whether further examination or tests are needed.")
      .moveDown()
      .fillColor("#9a3412")
      .text("This report contains a screening image and preliminary, unvalidated information only. It does not provide a confirmed diagnosis, treatment plan, or image-based risk category. Do not use it to delay professional care. AI output must be independently reviewed by a qualified clinician.");
    document.end();
  } catch (error) { next(error); }
};
export const addHabit: RequestHandler = async (req, res, next) => { try { const body = z.object({ name: z.string().min(1).max(120), frequency: z.string().max(80).optional(), quantity: z.number().min(0).optional(), unit: z.string().max(40).optional(), startedAt: z.coerce.date().optional(), stoppedAt: z.coerce.date().optional(), notes: z.string().max(2000).optional() }).strict().parse(req.body); const patient = String(req.params.id); if (!await ensurePatient(patient)) return error(res, "NOT_FOUND", "Patient not found.", 404); const habit = await Habit.create({ ...body, patient, createdBy: req.user!.id }); res.status(201).json({ habit }); } catch (e) { next(e); } };
export const addSymptom: RequestHandler = async (req, res, next) => { try { const body = z.object({ name: z.string().min(1).max(160), severity: z.enum(["mild", "moderate", "severe"]).optional(), durationDays: z.number().int().min(0).optional(), notes: z.string().max(2000).optional() }).strict().parse(req.body); const patient = String(req.params.id); if (!await ensurePatient(patient)) return error(res, "NOT_FOUND", "Patient not found.", 404); const symptom = await Symptom.create({ ...body, patient, createdBy: req.user!.id }); res.status(201).json({ symptom }); } catch (e) { next(e); } };

export const aiQualityCheck: RequestHandler = async (req, res, next) => {
  try {
    z.object({ patientId: z.string().regex(/^[a-f\d]{24}$/i) }).strict().parse(req.body);
    if (!req.file) return error(res, "FILE_REQUIRED", "An image is required.");
    const result = await qualityCheck(req.file.buffer);
    res.json({ ...result, state: result.pass ? "quality_ok" : "image_insufficient", error: result.pass ? null : "Image quality is insufficient." });
  } catch (error) {
    next(error);
  }
};
export const aiInfer: RequestHandler = async (req, res, next) => {
  try {
    const input = z.object({ caseId: z.string().regex(/^[a-f\d]{24}$/i), imageId: z.string().regex(/^[a-f\d]{24}$/i), modelKey: z.string().optional() }).strict().parse(req.body);
    const item = await ensureCase(input.caseId);
    if (!item) return error(res, "NOT_FOUND", "Case not found.", 404);
    const image = await CaseImage.findOne({ _id: input.imageId, case: item._id });
    if (!image) return error(res, "NOT_FOUND", "Case image not found.", 404);
    if (input.modelKey && input.modelKey !== "demo") return error(res, "AI_MODEL_UNAVAILABLE", "Only the deterministic demonstration model is configured.", 503);
    const result = await inferPersistedImage(item._id.toString(), image, req.user!.id);
    res.status(201).json({
      inference: {
        id: result.inference._id.toString(),
        status: "demo_not_validated",
        clinicallyValidated: false,
        model: result.inference.metadata?.model ?? null,
        processedAt: result.inference.createdAt
      },
      category: null,
      screeningReferenceId: item._id.toString(),
      processingStatus: "demo_not_validated",
      imageQualityStatus: image.qualityStatus,
      disclaimer: "The configured image model is a deterministic demonstration and has no clinical validation. No AI observation is provided. A qualified healthcare professional must independently review the image."
    });
  } catch (e) { next(e); }
};
export const aiHistory: RequestHandler = async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!await ensureCase(id)) return error(res, "NOT_FOUND", "Case not found.", 404);
    const inferences = await AiInference.find({ case: id }).sort({ createdAt: -1 }).populate("model", "name version");
    res.json({
      inferences: inferences.map((inference) => ({
        id: inference._id.toString(),
        status: "demo_not_validated",
        clinicallyValidated: false,
        model: inference.model,
        processedAt: inference.createdAt
      })),
      disclaimer: "The configured image model is a deterministic demonstration and has no clinical validation. No AI observations are provided."
    });
  } catch (e) { next(e); }
};
export const aiModels: RequestHandler = async (_req, res, next) => { try { res.json({ models: await AiModel.find({ status: "active" }).select("-__v") }); } catch (e) { next(e); } };
export const caseRiskScore: RequestHandler = async (req, res, next) => { try { const input = z.object({ symptoms: z.array(z.union([z.string().max(160), z.object({ name: z.string().max(160).optional(), severity: z.string().max(40).optional(), durationDays: z.number().int().min(0).optional() }).strict()])).optional(), habits: z.array(z.union([z.string().max(160), z.object({ name: z.string().max(160).optional(), quantity: z.number().min(0).optional(), durationYears: z.number().min(0).optional(), frequency: z.string().max(80).optional() }).strict()])).optional(), durationWeeks: z.number().min(0).optional(), age: z.number().int().min(0).max(120).optional(), redFlags: z.array(z.string().max(160)).optional(), aiState: z.enum(["image_insufficient", "suspicious_finding_for_clinical_review", "no_suspicious_finding_by_demo_model"]).optional(), tobaccoYears: z.number().min(0).optional(), arecaDaily: z.boolean().optional(), reverseSmoking: z.boolean().optional(), alcoholWithTobacco: z.boolean().optional() }).strict().parse(req.body); if (!await ensureCase(String(req.params.id))) return error(res, "NOT_FOUND", "Case not found.", 404); const result = riskScore(input); res.json({ risk: result, disclaimer: "NOT FOR CLINICAL USE" }); } catch (e) { next(e); } };

export const createPlan: RequestHandler = async (req, res, next) => { try { const body = z.object({ goal: z.string().min(1).max(500), targetDate: z.coerce.date().optional(), steps: z.array(z.string().max(500)).max(30).optional() }).strict().parse(req.body); const patient = String(req.params.id); if (!await ensurePatient(patient)) return error(res, "NOT_FOUND", "Patient not found.", 404); const plan = await CessationPlan.create({ ...body, patient, createdBy: req.user!.id }); res.status(201).json({ plan }); } catch (e) { next(e); } };
export const listPlans: RequestHandler = async (req, res, next) => { try { res.json({ plans: await CessationPlan.find({ patient: req.params.id }).sort({ createdAt: -1 }) }); } catch (e) { next(e); } };
export const updatePlan: RequestHandler = async (req, res, next) => { try { const body = z.object({ goal: z.string().min(1).max(500).optional(), targetDate: z.coerce.date().nullable().optional(), steps: z.array(z.string().max(500)).max(30).optional(), status: z.enum(["active", "completed", "cancelled"]).optional() }).strict().refine((value) => Object.keys(value).length > 0).parse(req.body); const plan = await CessationPlan.findOneAndUpdate({ _id: req.params.planId, patient: req.params.id }, { $set: body }, { new: true, runValidators: true }); if (!plan) return error(res, "NOT_FOUND", "Cessation plan not found.", 404); res.json({ plan }); } catch (e) { next(e); } };
export const deletePlan: RequestHandler = async (req, res, next) => { try { const plan = await CessationPlan.findOneAndUpdate({ _id: req.params.planId, patient: req.params.id }, { $set: { status: "cancelled" } }, { new: true, runValidators: true }); if (!plan) return error(res, "NOT_FOUND", "Cessation plan not found.", 404); res.status(204).send(); } catch (e) { next(e); } };
