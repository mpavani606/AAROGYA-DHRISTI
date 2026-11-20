import type { RequestHandler } from "express";
import { z } from "zod";
import { MedicalRecord } from "../models/MedicalRecord.js";
import { MediaObject } from "../models/MediaObject.js";
import { Patient } from "../models/Patient.js";
import { AuditLog } from "../models/AuditLog.js";
import { env } from "../config/env.js";
import { decryptBuffer, encryptBuffer } from "../services/encryption.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cloudinarySignedUrl, expiry, hashBuffer, localFile, localSignedUrl, processUpload, saveLocal, uploadCloudinary } from "../services/mediaService.js";

const recordInput = z.object({
  recordType: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  recordDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sourceHospital: z.string().trim().max(200).optional(),
  sourceHospitalType: z.enum(["government", "private"]).optional(),
  sourceDoctor: z.string().trim().max(200).optional(),
  notes: z.string().max(10000).optional(),
  version: z.coerce.number().int().positive().optional(),
  recordId: z.string().optional()
});
const auditWrite = (req: Parameters<RequestHandler>[0], action: string, resourceId: string) =>
  AuditLog.create({ actor: req.user?.id, action, resource: "medical-record", resourceId, ip: req.ip, userAgent: req.get("user-agent") });

export const createMedicalRecord: RequestHandler = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: "FILE_REQUIRED", message_en: "Upload a PDF or image for this medical record." } });
    const input = recordInput.parse(req.body);
    const patientId = String(req.params.id);
    if (!await Patient.exists({ _id: patientId, active: true })) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Patient not found." } });
    const mediaIds: string[] = [];
    if (req.file) {
      const processed = await processUpload(req.file.buffer, req.file.mimetype);
      const key = `${patientId}/${hashBuffer(processed.buffer)}-${Date.now()}.${processed.mimeType === "application/pdf" ? "pdf" : "jpg"}`;
      const configuredCloudinary = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
      const storageKey = configuredCloudinary ? await uploadCloudinary(processed.buffer, key, processed.mimeType) : key;
      if (!configuredCloudinary) await saveLocal(encryptBuffer(processed.buffer), key);
      const media = await MediaObject.create({ patient: patientId, originalName: req.file.originalname, mimeType: processed.mimeType, size: processed.buffer.length, sha256: hashBuffer(processed.buffer), storage: configuredCloudinary ? "cloudinary" : "local", storageKey, encryptedAtRest: !configuredCloudinary, width: processed.width, height: processed.height });
      mediaIds.push(media._id.toString());
    }
    let record;
    if (input.recordId) {
      const previous = await MedicalRecord.findOne({ _id: input.recordId, patient: patientId, deletedAt: { $exists: false } });
      if (!previous || input.version !== previous.version) return res.status(409).json({ error: { code: "VERSION_CONFLICT", message_en: "This record was changed; reload and retry." } });
      previous.supersededAt = new Date();
      await previous.save();
      record = await MedicalRecord.create({ patient: patientId, author: req.user!.id, recordType: input.recordType, title: input.title, recordDate: input.recordDate, sourceHospital: input.sourceHospital, sourceHospitalType: input.sourceHospitalType, sourceDoctor: input.sourceDoctor, notes: input.notes, media: mediaIds, version: previous.version + 1, previousVersion: previous._id });
    } else {
      record = await MedicalRecord.create({ patient: patientId, author: req.user!.id, recordType: input.recordType, title: input.title, recordDate: input.recordDate, sourceHospital: input.sourceHospital, sourceHospitalType: input.sourceHospitalType, sourceDoctor: input.sourceDoctor, notes: input.notes, media: mediaIds });
    }
    await MediaObject.updateMany({ _id: { $in: mediaIds } }, { record: record._id });
    await auditWrite(req, input.recordId ? "medical-record.version-created" : "medical-record.created", record._id.toString());
    res.status(201).json({ record });
  } catch (e) { next(e); }
};

export const getMediaSignedUrl: RequestHandler = async (req, res, next) => {
  try {
    const media = await MediaObject.findById(req.params.id);
    if (!media || media.deletedAt) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Media not found." } });
    const expiresAt = expiry();
    const signedUrl = media.storage === "local" ? localSignedUrl(media.storageKey, expiresAt) : cloudinarySignedUrl(media.storageKey, expiresAt, media.mimeType);
    await auditWrite(req, "media.signed-url.created", media._id.toString());
    res.json({ signedUrl, expiresAt: expiresAt.toISOString(), expiresIn: 300 });
  } catch (e) { next(e); }
};

export const downloadLocalMedia: RequestHandler = async (req, res, next) => {
  try {
    const key = String(req.params[0] ?? "");
    const expires = Number(req.query.expires);
    const signature = typeof req.query.signature === "string" ? req.query.signature : "";
    if (!/^([a-f\d]{24})\/[a-f\d]{64}-\d+\.(pdf|jpg)$/i.test(key) || key.includes("\\") || path.posix.normalize(key) !== key || !Number.isSafeInteger(expires) || expires <= Date.now() || expires > Date.now() + 5 * 60_000 || !/^[a-f\d]{64}$/i.test(signature)) {
      return res.status(403).json({ error: { code: "INVALID_MEDIA_SIGNATURE", message_en: "This media link is invalid or expired." } });
    }
    const expected = crypto.createHmac("sha256", env.JWT_SECRET).update(`${key}:${expires}`).digest();
    const received = Buffer.from(signature, "hex");
    if (!crypto.timingSafeEqual(expected, received)) return res.status(403).json({ error: { code: "INVALID_MEDIA_SIGNATURE", message_en: "This media link is invalid or expired." } });

    const media = await MediaObject.findOne({ storageKey: key, storage: "local" }).select("mimeType originalName encryptedAtRest deletedAt");
    if (!media || media.deletedAt) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Media not found." } });
    res.setHeader("Content-Type", media.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(media.originalName).replace(/["\\\r\n]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const storedBuffer = await fs.promises.readFile(localFile(key));
    const buffer = media.encryptedAtRest ? decryptBuffer(storedBuffer) : storedBuffer;
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (e) { next(e); }
};

export const patientTimeline: RequestHandler = async (req, res, next) => {
  try {
    const patient = await Patient.findById(req.params.id).select("createdAt");
    if (!patient) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Patient not found." } });
    const records = await MedicalRecord.find({ patient: req.params.id, deletedAt: { $exists: false } }).sort({ createdAt: 1 }).lean();
    const events = [{ type: "patient.created", date: patient.createdAt, label: "Patient created", sourceId: String(patient._id) }, ...records.map((record) => ({ type: "medical-record", date: record.recordDate ?? record.createdAt, label: record.title, sourceId: String(record._id), record }))];
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    res.json({ events });
  } catch (e) { next(e); }
};
