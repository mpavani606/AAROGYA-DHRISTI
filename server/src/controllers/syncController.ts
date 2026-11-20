import type { RequestHandler } from "express";
import { z } from "zod";
import { SyncBatch } from "../models/SyncBatch.js";
import { SyncItem } from "../models/SyncItem.js";
import { ConflictReview } from "../models/ConflictReview.js";
import { ChunkUpload } from "../models/ChunkUpload.js";
import { Patient } from "../models/Patient.js";
import { Case } from "../models/Case.js";
import { Consent } from "../models/Consent.js";
import { Habit } from "../models/Habit.js";
import { Symptom } from "../models/Symptom.js";
import { encryptPatientFields, phoneHashVariants } from "../services/patientService.js";
import { processUpload, hashBuffer, saveLocal } from "../services/mediaService.js";
import { encryptBuffer } from "../services/encryption.js";
import { qualityCheck } from "../services/aiService.js";
import { inferPersistedImage, screeningCategory } from "../services/screeningService.js";
import { queueWorkflowNotification } from "../services/workflowNotificationService.js";
import { logger } from "../services/logger.js";
import { CaseImage } from "../models/CaseImage.js";
import { missingChunkIndexes, requiresConflictReview } from "../services/syncPolicy.js";
import { Appointment } from "../models/Appointment.js";
import { User } from "../models/User.js";
import { Token } from "../models/Token.js";
import { MedicineRefillRequest } from "../models/MedicineRefillRequest.js";
import { Prescription } from "../models/Prescription.js";
import { MedicalRecord } from "../models/MedicalRecord.js";
import { EmergencyRequest } from "../models/EmergencyRequest.js";
import { LocationShare } from "../models/LocationShare.js";
import { notifyEmergencyStaffForPatient } from "./communityController.js";
import { createGeminiScreeningObservation } from "../services/geminiObservationService.js";
import { bookAppointment } from "../services/appointmentBookingService.js";
import { queuePatientNotification } from "../services/workflowNotificationService.js";

const error = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) => res.status(status).json({ error: { code, message_en, message_te: "సమకాలీకరణ విఫలమైంది.", message_hi: "सिंक विफल हुआ।" } });
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const syncPullQuerySchema = z.object({ since: z.string().datetime().optional() }).strict();
export const syncCreatePatientPayloadSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(7).max(20).optional(),
  address: z.string().trim().max(500).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
  }).optional(),
  abha: z.string().trim().max(80).optional(),
  aarogyasri: z.string().trim().max(100).optional(),
  mandal: z.string().trim().min(1).max(100),
  preferredLanguage: z.enum(["en", "te", "hi"]).optional()
}).strict();
const operationSchema = z.object({ clientUuid: z.string().uuid(), opType: z.enum(["create_patient", "create_case", "create_consent", "create_habit", "create_symptom", "create_refill_request", "create_emergency_request", "create_appointment_request", "signed_review", "signed_note", "update_patient"]), payload: z.record(z.string(), z.unknown()), deviceTime: z.string().optional() });

async function hasPatientScope(userId: string, patientId: string) {
  const [patient, user] = await Promise.all([
    Patient.findById(patientId).select("createdBy mandal mandalId phcId villageId phoneHash active"),
    User.findById(userId).select("role assignments phone")
  ]);
  if (!patient || !patient.active || !user) return false;
  if (user.role === "patient") return Boolean(user.phone && patient.phoneHash && phoneHashVariants(user.phone).includes(patient.phoneHash));
  if ((user.role !== "asha_worker" && patient.createdBy?.toString() === userId) || ["district_admin", "system_admin"].includes(user.role)) return true;
  return user.assignments.some((assignment: { mandal?: string; village?: string; phc?: string; scope?: string }) => {
    if (user.role === "asha_worker") return Boolean(assignment.village || assignment.phc)
      && (!assignment.mandal || assignment.mandal === patient.mandal || assignment.mandal === patient.mandalId?.toString())
      && (!assignment.village || assignment.village === patient.villageId?.toString())
      && (!assignment.phc || assignment.phc === patient.phcId?.toString());
    return assignment.scope === "all"
      || Boolean(assignment.mandal && (assignment.mandal === patient.mandal || assignment.mandal === patient.mandalId?.toString()))
      || Boolean(assignment.village && assignment.village === patient.villageId?.toString())
      || Boolean(assignment.phc && assignment.phc === patient.phcId?.toString());
  });
}

async function hasScreeningConsent(patientId: string) {
  return Boolean(await Consent.exists({
    patient: patientId,
    purpose: "screening",
    granted: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
  }));
}

async function findPatientForAccount(userId: string) {
  const user = await User.findById(userId).select("phone role");
  if (user?.role !== "patient" || !user.phone) return null;
  const patients = await Patient.find({ phoneHash: { $in: phoneHashVariants(user.phone) }, active: true })
    .select("_id patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId").limit(2);
  return patients.length === 1 ? patients[0] : null;
}

async function patientScreeningConsentRequired(userId: string, patientId: string) {
  void userId;
  return !await hasScreeningConsent(patientId);
}

async function ensurePatientToken(patient: { _id: { toString(): string }; mandal: string }, clientUuid: string) {
  const existing = await Token.findOne({ clientUuid });
  if (existing) return existing.token;
  const mandalCode = patient.mandal.replace(/[^A-Za-z]/g, "").toUpperCase().padEnd(3, "X").slice(0, 3);
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const latest = await Token.findOne({ mandal: mandalCode, year }).sort({ sequence: -1 });
    const sequence = (latest?.sequence ?? 0) + 1;
    const token = `AD-${mandalCode}-${year}-${String(sequence).padStart(6, "0")}`;
    try { return (await Token.create({ patient: patient._id, clientUuid, mandal: mandalCode, year, sequence, token })).token; }
    catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const saved = await Token.findOne({ clientUuid });
      if (saved) return saved.token;
    }
  }
  throw new Error("Unable to allocate an offline-synced patient token.");
}

async function applyOperation(operation: z.infer<typeof operationSchema>, deviceId: string, userId: string) {
  const cached = await SyncItem.findOne({ deviceId, clientUuid: operation.clientUuid, user: userId });
  if (cached) return cached.result;
  if (requiresConflictReview(operation.opType)) {
    const conflict = await ConflictReview.create({ user: userId, deviceId, clientUuid: operation.clientUuid, entityType: operation.opType, entityId: String(operation.payload.entityId ?? ""), localPayload: operation.payload });
    const result = { status: "conflict_review", conflictId: conflict._id.toString() };
    await persistSyncItem({ clientUuid: operation.clientUuid, deviceId, user: userId, opType: operation.opType, result });
    return result;
  }
  let entity: { _id: { toString(): string }; toObject?: () => unknown } | null = null;
  const payload = operation.payload;
  let tokenNo: string | undefined;
  if (operation.opType === "create_patient") {
    const body = syncCreatePatientPayloadSchema.parse(payload);
    const existing = await Patient.findOne({ clientUuid: operation.clientUuid }).select("createdBy");
    if (existing && existing.createdBy?.toString() !== userId) return { status: "failed", code: "CLIENT_UUID_CONFLICT" };
    const patientCode = `ADP-${operation.clientUuid.slice(0, 8).toUpperCase()}`;
    entity = await Patient.findOneAndUpdate({ clientUuid: operation.clientUuid, createdBy: userId }, { $setOnInsert: { ...encryptPatientFields(body), createdBy: userId, clientUuid: operation.clientUuid, patientCode } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    tokenNo = await ensurePatientToken(entity as { _id: { toString(): string }; mandal: string }, operation.clientUuid);
  } else if (operation.opType === "create_case") {
    const body = z.object({ patientId: objectIdSchema, notes: z.string().max(10000).optional() }).strict().parse(payload);
    if (!await hasPatientScope(userId, body.patientId)) return { status: "failed", code: "OUTSIDE_ASSIGNMENT" };
    if (await patientScreeningConsentRequired(userId, body.patientId)) return { status: "failed", code: "CONSENT_REQUIRED" };
    const existing = await Case.findOne({ clientUuid: operation.clientUuid }).select("createdBy");
    if (existing && existing.createdBy.toString() !== userId) return { status: "failed", code: "CLIENT_UUID_CONFLICT" };
    const caseRecord = await Case.findOneAndUpdate({ clientUuid: operation.clientUuid, createdBy: userId }, { $setOnInsert: { patient: body.patientId, notes: body.notes, createdBy: userId, clientUuid: operation.clientUuid, status: "submitted" } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    entity = caseRecord;
    await queueWorkflowNotification({ eventKey: `screening:${caseRecord._id}`, patientId: body.patientId, actorId: userId, template: "screening_submitted" });
  } else if (operation.opType === "create_consent") {
    const body = z.object({ patientId: objectIdSchema.optional(), patientClientUuid: z.string().uuid().optional(), purpose: z.enum(["registration", "screening", "examination", "imaging", "teleconsultation", "location", "abha_linking", "data_processing", "external_ai"]), granted: z.boolean() }).strict().refine((value) => Boolean(value.patientId || value.patientClientUuid)).parse(payload);
    const linkedPatient = body.patientId ? null : await Patient.findOne({ clientUuid: body.patientClientUuid, createdBy: userId }).select("_id");
    const patientId = body.patientId ?? linkedPatient?._id.toString();
    if (!patientId) return { status: "failed", code: "PATIENT_NOT_FOUND" };
    if (!await hasPatientScope(userId, patientId)) return { status: "failed", code: "OUTSIDE_ASSIGNMENT" };
    if (body.purpose === "external_ai") {
      const accountPatient = await findPatientForAccount(userId);
      if (!accountPatient || accountPatient._id.toString() !== patientId) return { status: "failed", code: "PATIENT_CONSENT_REQUIRED" };
    }
    const existing = await Consent.findOne({ clientUuid: operation.clientUuid }).select("grantedBy");
    if (existing && existing.grantedBy?.toString() !== userId) return { status: "failed", code: "CLIENT_UUID_CONFLICT" };
    entity = await Consent.findOneAndUpdate({ clientUuid: operation.clientUuid, grantedBy: userId }, { $setOnInsert: { patient: patientId, purpose: body.purpose, granted: body.granted, grantedBy: userId, clientUuid: operation.clientUuid } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } else if (operation.opType === "create_habit" || operation.opType === "create_symptom") {
    const body = z.object({ patientId: objectIdSchema, name: z.string().min(1).max(160), notes: z.string().max(2000).optional(), frequency: z.string().max(80).optional(), quantity: z.number().min(0).optional(), durationDays: z.number().min(0).optional(), severity: z.enum(["mild", "moderate", "severe"]).optional() }).strict().parse(payload);
    if (!await hasPatientScope(userId, body.patientId)) return { status: "failed", code: "OUTSIDE_ASSIGNMENT" };
    if (await patientScreeningConsentRequired(userId, body.patientId)) return { status: "failed", code: "CONSENT_REQUIRED" };
    const model = operation.opType === "create_habit" ? Habit : Symptom;
    const existing = await model.findOne({ clientUuid: operation.clientUuid }).select("createdBy");
    if (existing && existing.createdBy.toString() !== userId) return { status: "failed", code: "CLIENT_UUID_CONFLICT" };
    entity = await model.findOneAndUpdate({ clientUuid: operation.clientUuid, createdBy: userId }, { $setOnInsert: { ...body, patient: body.patientId, createdBy: userId, clientUuid: operation.clientUuid } }, { upsert: true, new: true, setDefaultsOnInsert: true }) as typeof entity;
  } else if (operation.opType === "create_appointment_request") {
    const body = z.object({
      clientUuid: z.string().uuid(),
      type: z.enum(["video", "physical"]),
      clinicianId: objectIdSchema,
      hospitalId: objectIdSchema,
      availabilityId: objectIdSchema,
      startAt: z.coerce.date(),
      endAt: z.coerce.date()
    }).strict().parse(payload);
    if (body.clientUuid !== operation.clientUuid) return { status: "failed", code: "CLIENT_UUID_MISMATCH" };
    const patient = await findPatientForAccount(userId);
    if (!patient) return { status: "failed", code: "PATIENT_NOT_FOUND" };
    try {
      const booking = await bookAppointment({ ...body, patientId: patient._id.toString() });
      entity = booking.appointment;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
        return { status: "failed", code: error.code };
      }
      throw error;
    }
  } else if (operation.opType === "create_refill_request") {
    const body = z.object({
      clientUuid: z.string().uuid().optional(),
      prescriptionRecordId: objectIdSchema.optional(),
      prescriptionId: objectIdSchema.optional(),
      medicineName: z.string().trim().min(1).max(160),
      dosage: z.string().trim().max(160).optional(),
      quantity: z.number().int().min(1).max(365),
      notes: z.string().trim().max(500).optional()
    }).strict().parse(payload);
    if (body.clientUuid && body.clientUuid !== operation.clientUuid) return { status: "failed", code: "CLIENT_UUID_MISMATCH" };
    const patient = await findPatientForAccount(userId);
    if (!patient) return { status: "failed", code: "PATIENT_NOT_FOUND" };
    if (body.prescriptionRecordId && !await MedicalRecord.exists({
      _id: body.prescriptionRecordId,
      patient: patient._id,
      recordType: { $regex: "prescription", $options: "i" },
      deletedAt: { $exists: false }
    })) {
      return { status: "failed", code: "PRESCRIPTION_NOT_FOUND" };
    }
    if (body.prescriptionId && !await Prescription.exists({ _id: body.prescriptionId, patient: patient._id })) {
      return { status: "failed", code: "PRESCRIPTION_NOT_FOUND" };
    }
    entity = await MedicineRefillRequest.findOneAndUpdate(
      { patient: patient._id, clientUuid: operation.clientUuid },
      { $setOnInsert: {
        medicineName: body.medicineName,
        dosage: body.dosage,
        quantity: body.quantity,
        notes: body.notes,
        prescription: body.prescriptionId,
        prescriptionRecord: body.prescriptionRecordId,
        patient: patient._id,
        clientUuid: operation.clientUuid,
        status: "pending"
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ) as typeof entity;
    await queuePatientNotification({
      eventKey: `refill:${entity!._id.toString()}`,
      patientId: patient._id.toString(),
      template: "refill_request_submitted"
    });
  } else if (operation.opType === "create_emergency_request") {
    const body = z.object({
      clientRequestId: z.string().uuid(),
      category: z.enum(["urgent_help", "transport", "other"]),
      message: z.string().trim().min(1).max(500),
      locationShareId: objectIdSchema.optional()
    }).strict().parse(payload);
    const patient = await findPatientForAccount(userId);
    if (!patient) return { status: "failed", code: "PATIENT_NOT_FOUND" };
    if (body.locationShareId) {
      const location = await LocationShare.findOne({
        _id: body.locationShareId,
        patient: patient._id,
        expiresAt: { $gt: new Date() }
      }).select("consent");
      if (!location || !await Consent.exists({
        _id: location.consent,
        patient: patient._id,
        purpose: "location",
        granted: true,
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
      })) return { status: "failed", code: "LOCATION_CONSENT_REQUIRED" };
    }
    const existing = await EmergencyRequest.findOne({ patient: patient._id, clientRequestId: body.clientRequestId });
    const emergencyRequest = existing ?? await EmergencyRequest.create({
      patient: patient._id,
      clientRequestId: body.clientRequestId,
      category: body.category,
      message: body.message,
      locationShare: body.locationShareId,
      status: "submitted",
      statusHistory: [{ status: "submitted", changedBy: userId, changedAt: new Date() }]
    });
    entity = emergencyRequest;
    await notifyEmergencyStaffForPatient(patient._id.toString(), emergencyRequest._id.toString(), ["asha_worker", "doctor", "district_admin", "hospital_manager", "system_admin"]);
    await queuePatientNotification({
      eventKey: `emergency:${emergencyRequest._id}`,
      patientId: patient._id.toString(),
      template: "emergency_request_submitted"
    });
  } else if (operation.opType === "update_patient") {
    const body = z.object({ patientId: z.string(), fields: z.record(z.string(), z.unknown()), serverUpdatedAt: z.string().optional() }).parse(payload);
    if (!await hasPatientScope(userId, body.patientId)) return { status: "failed", code: "OUTSIDE_ASSIGNMENT" };
    const patient = await Patient.findById(body.patientId);
    if (!patient) return { status: "failed", code: "PATIENT_NOT_FOUND" };
    const fields = z.object({
      name: z.string().trim().min(2).max(200).optional(),
      address: z.string().trim().max(500).optional(),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
      }).optional(),
      gender: z.enum(["female", "male", "other", "prefer_not_to_say"]).optional()
    }).strict().refine((value) => Object.keys(value).length > 0).parse(body.fields);
    const encrypted = encryptPatientFields(fields);
    if (!fields.name) delete encrypted.nameNormalized;
    entity = await Patient.findOneAndUpdate({ _id: body.patientId }, { $set: encrypted, $inc: { version: 1 } }, { new: true });
  }
  const result = { status: "synced", entityId: entity?._id.toString(), serverUpdatedAt: new Date().toISOString(), ...(operation.opType === "create_patient" ? { patientCode: (entity as { patientCode?: string } | null)?.patientCode, tokenNo } : {}) };
  if (!entity && operation.opType === "update_patient") return { status: "failed", code: "PATIENT_NOT_FOUND" };
  await persistSyncItem({ clientUuid: operation.clientUuid, deviceId, user: userId, opType: operation.opType, entityId: result.entityId, result });
  return result;
}

async function persistSyncItem(data: { clientUuid: string; deviceId: string; user: string; opType: string; entityId?: string; result: Record<string, unknown> }) {
  try { await SyncItem.create(data); }
  catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const existing = await SyncItem.findOne({ clientUuid: data.clientUuid, deviceId: data.deviceId, user: data.user });
    if (!existing) throw error;
    return existing.result;
  }
  return data.result;
}

export const syncBatch: RequestHandler = async (req, res, next) => {
  try {
    const deviceId = z.string().min(8).max(128).parse(req.header("x-device-id"));
    const idempotencyKey = z.string().min(8).max(128).parse(req.header("idempotency-key"));
    const body = z.object({ operations: z.array(operationSchema).min(1).max(20) }).parse(req.body);
    const patientOperations = new Set(["create_consent", "create_case", "create_habit", "create_symptom", "create_refill_request", "create_emergency_request", "create_appointment_request", "update_patient"]);
    if (req.user!.role === "patient" && body.operations.some((operation) => !patientOperations.has(operation.opType))) return error(res, "FORBIDDEN", "Patient accounts can sync only their own consented screening records.", 403);
    const existing = await SyncBatch.findOne({ deviceId, idempotencyKey, user: req.user!.id });
    if (existing) return res.json(existing.result);
    const results = [];
    for (const operation of body.operations) results.push({ clientUuid: operation.clientUuid, ...await applyOperation(operation, deviceId, req.user!.id) });
    const result = { results, syncedAt: new Date().toISOString() };
    try { await SyncBatch.create({ deviceId, idempotencyKey, user: req.user!.id, result }); }
    catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const saved = await SyncBatch.findOne({ deviceId, idempotencyKey, user: req.user!.id });
      if (!saved) throw e;
      return res.json(saved.result);
    }
    res.json(result);
  } catch (e) { next(e); }
};

export const syncPull: RequestHandler = async (req, res, next) => {
  try {
    const query = syncPullQuerySchema.parse(req.query);
    const since = query.since ? new Date(query.since) : new Date(0);
    const user = await User.findById(req.user!.id).select("assignments status role");
    if (!user || user.status !== "active") return res.status(401).json({ wipeLocalData: true });
    const patients = await Patient.find({ createdBy: req.user!.id }).select("_id");
    const appointmentScopes: Array<Record<string, unknown>> = [{ patient: { $in: patients.map((patient) => patient._id) } }];
    if (user.role === "doctor") appointmentScopes.push({ clinician: req.user!.id });
    const appointments = await Appointment.find({ $or: appointmentScopes, updatedAt: { $gt: since } }).limit(100);
    const recaptureRequests = await Case.find({ status: "recapture_requested", createdBy: req.user!.id, updatedAt: { $gt: since } }).limit(100);
    res.json({ assignments: user.assignments, appointments, recaptureRequests, education: [{ id: "offline-basics", locales: ["en", "te", "hi"] }], pulledAt: new Date().toISOString() });
  } catch (e) { next(e); }
};

export const startChunkUpload: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ uploadId: z.string().uuid(), caseId: objectIdSchema, fileName: z.string().min(1).max(255), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), totalChunks: z.number().int().min(1).max(40) }).strict().parse(req.body);
    const caseItem = await Case.findById(body.caseId).select("patient");
    if (!caseItem) return error(res, "CASE_NOT_FOUND", "Case not found.", 404);
    if (!await hasPatientScope(req.user!.id, caseItem.patient.toString())) return error(res, "FORBIDDEN", "This case is outside your assignment.", 403);
    if (await patientScreeningConsentRequired(req.user!.id, caseItem.patient.toString())) return error(res, "CONSENT_REQUIRED", "Patient screening consent is required.", 403);
    const upload = await ChunkUpload.findOneAndUpdate({ uploadId: body.uploadId, user: req.user!.id }, { $setOnInsert: { ...body, user: req.user!.id, deviceId: String(req.header("x-device-id") ?? "unknown"), chunks: [], status: "uploading" } }, { upsert: true, new: true });
    const received = upload.chunks.map((part: { index: number }) => part.index);
    res.json({ uploadId: upload.uploadId, received, missing: missingChunkIndexes(upload.totalChunks, received), nextOffset: missingChunkIndexes(upload.totalChunks, received)[0] ?? upload.totalChunks });
  } catch (e) { next(e); }
};

export const uploadChunk: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ index: z.number().int().min(0), data: z.string().min(1).max(350_000) }).parse(req.body);
    const upload = await ChunkUpload.findOne({ uploadId: String(req.params.uploadId), user: req.user!.id });
    if (!upload) return error(res, "UPLOAD_NOT_FOUND", "Upload session not found.", 404);
    if (body.index >= upload.totalChunks) return error(res, "INVALID_CHUNK", "Chunk index is outside the upload.");
    if (Buffer.from(body.data, "base64").length > 256 * 1024) return error(res, "CHUNK_TOO_LARGE", "Each image chunk is limited to 256 KB.", 413);
    if (!upload.chunks.some((chunk: { index: number }) => chunk.index === body.index)) {
      upload.chunks.push({ index: body.index, data: Buffer.from(body.data, "base64") });
      await upload.save();
    }
    const missing = missingChunkIndexes(upload.totalChunks, upload.chunks.map((chunk: { index: number }) => chunk.index));
    if (missing.length) return res.json({ received: upload.chunks.map((chunk: { index: number }) => chunk.index), missing, complete: false });
    const buffer = Buffer.concat([...upload.chunks].sort((a: { index: number }, b: { index: number }) => a.index - b.index).map((chunk: { data: Buffer }) => Buffer.from(chunk.data)));
    if (buffer.length > 10 * 1024 * 1024) return error(res, "FILE_TOO_LARGE", "Image uploads are limited to 10 MB.", 413);
    const processed = await processUpload(buffer, upload.mimeType);
    const sha = hashBuffer(processed.buffer);
    const quality = await qualityCheck(processed.buffer);
    const caseItem = await Case.findById(upload.caseId);
    if (!caseItem) return error(res, "CASE_NOT_FOUND", "Case not found.", 404);
    if (!await hasPatientScope(req.user!.id, caseItem.patient.toString())) return error(res, "FORBIDDEN", "This case is outside your assignment.", 403);
    if (await patientScreeningConsentRequired(req.user!.id, caseItem.patient.toString())) return error(res, "CONSENT_REQUIRED", "Patient screening consent is required.", 403);
    const storageKey = `cases/${upload.caseId}/${sha}.jpg`;
    await saveLocal(encryptBuffer(processed.buffer), storageKey);
    const image = await CaseImage.findOneAndUpdate({ storageKey }, { $setOnInsert: { case: caseItem._id, patient: caseItem.patient, originalName: upload.fileName, mimeType: "image/jpeg", size: processed.buffer.length, storageKey, width: processed.width, height: processed.height, sha256: sha, qualityStatus: quality.pass ? "usable" : "insufficient", encryptedAtRest: true } }, { upsert: true, new: true });
    upload.status = "complete"; upload.completedAt = new Date(); await upload.save();
    let aiProcessingStatus = "completed";
    let aiCategory = screeningCategory("AI_PROCESSING_UNAVAILABLE");
    try {
      const inference = await inferPersistedImage(caseItem._id.toString(), image, req.user!.id);
      aiCategory = inference.category;
    } catch (error) {
      aiProcessingStatus = "AI_PROCESSING_UNAVAILABLE";
      logger.error({ code: error instanceof Error ? error.name : "AI_PROCESSING_ERROR" }, "Demonstration screening inference failed; image remains available for doctor review");
    }
    let geminiStatus = "consent_required";
    try {
      const observation = await createGeminiScreeningObservation(caseItem._id.toString(), image, req.user!.id, processed.buffer);
      geminiStatus = observation.status;
    } catch (error) {
      geminiStatus = "unavailable";
      logger.error({ code: error instanceof Error && "code" in error ? error.code : "GEMINI_ASSESSMENT_FAILED" }, "Consented Gemini observation could not be completed during image sync");
    }
    res.json({ received: upload.chunks.map((chunk: { index: number }) => chunk.index), missing: [], complete: true, imageId: image._id.toString(), aiProcessingStatus, aiCategory, geminiStatus });
  } catch (e) { next(e); }
};

export const chunkStatus: RequestHandler = async (req, res, next) => {
  try { const upload = await ChunkUpload.findOne({ uploadId: String(req.params.uploadId), user: req.user!.id }).select("uploadId totalChunks chunks.index status"); if (!upload) return error(res, "UPLOAD_NOT_FOUND", "Upload session not found.", 404); res.json({ uploadId: upload.uploadId, totalChunks: upload.totalChunks, received: upload.chunks.map((chunk: { index: number }) => chunk.index), status: upload.status }); } catch (e) { next(e); }
};
