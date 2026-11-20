import type { RequestHandler } from "express";
import { z } from "zod";
import { Patient } from "../models/Patient.js";
import { PatientIdentifier } from "../models/PatientIdentifier.js";
import { Consent } from "../models/Consent.js";
import { FamilyLink } from "../models/FamilyLink.js";
import { Token } from "../models/Token.js";
import { encryptPatientFields, findPossibleDuplicates, hashIdentifier, phoneHashVariants, presentPatient } from "../services/patientService.js";
import { patientIsAssigned, patientIsWithinDistrict, patientLocationIsWithinDistrict } from "../middleware/patientCareRelationship.js";
import { permittedDashboardMandals } from "../services/dashboardService.js";
import { Mandal } from "../models/Geo.js";
import { processUpload } from "../services/mediaService.js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const dateOfBirthSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
});
export const patientListQuerySchema = z.object({ mandal: z.string().trim().min(1).max(100).optional(), search: z.string().trim().min(2).max(100).optional() }).strict();
export const createPatientQuerySchema = z.object({ confirm: z.enum(["true", "false"]).optional() }).strict();
export const patientSchema = z.object({ name: z.string().min(2).max(200), phone: z.string().min(7).optional(), address: z.string().max(500).optional(), dateOfBirth: dateOfBirthSchema.optional(), gender: z.enum(["female", "male", "other", "prefer_not_to_say"]).optional(), abha: z.string().optional(), aarogyasri: z.string().optional(), mandal: z.string().min(1), preferredLanguage: z.enum(["en", "te", "hi"]).optional(), ageYears: z.number().int().min(0).max(120).optional(), mandalId: z.string().regex(/^[a-f\d]{24}$/i).optional(), phcId: z.string().regex(/^[a-f\d]{24}$/i).optional(), villageId: z.string().regex(/^[a-f\d]{24}$/i).optional(), habitationId: z.string().regex(/^[a-f\d]{24}$/i).optional() });
const userCanAccessPatientLocation = async (location: { createdBy?: { toString(): string }; mandal?: string; mandalId?: string; phcId?: string; habitationId?: string }, user: NonNullable<Express.Request["user"]>) =>
  user.role === "system_admin" ||
  (user.role === "district_admin" ? await patientLocationIsWithinDistrict(location, location.mandal ?? "", user) : patientIsAssigned(location, user));
const visibleDuplicateMatches = async (matches: Awaited<ReturnType<typeof findPossibleDuplicates>>, user: NonNullable<Express.Request["user"]>) => {
  if (user.role === "system_admin") return matches;
  const allowed = await Promise.all(matches.map((patient) => user.role === "district_admin" ? patientIsWithinDistrict(patient, user) : patientIsAssigned(patient, user)));
  return matches.filter((_patient, index) => allowed[index]);
};
export const duplicateCheck: RequestHandler = async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(2), mandal: z.string().min(1), phone: z.string().optional(), age: z.number().optional(), village: z.string().optional() }).parse(req.body);
    if (!await userCanAccessPatientLocation({ mandal: input.mandal }, req.user!)) return res.status(403).json({ error: { code: "OUT_OF_SCOPE", message_en: "The requested location is outside your assigned area." } });
    const matches = await visibleDuplicateMatches(await findPossibleDuplicates(input.name, input.mandal), req.user!);
    res.json({ duplicate: matches.length > 0, similarityScore: matches.length ? 0.8 : 0, matches: matches.map(presentPatient) });
  } catch (e) { next(e); }
};
export const createPatient: RequestHandler = async (req, res, next) => { try {
  const data = patientSchema.parse(req.body);
  const query = createPatientQuerySchema.parse(req.query);
  if (!await userCanAccessPatientLocation(data, req.user!)) return res.status(403).json({ error: { code: "OUT_OF_SCOPE", message_en: "The patient must be registered within your assigned area." } });
  const duplicates = await visibleDuplicateMatches(await findPossibleDuplicates(data.name, data.mandal), req.user!);
  if (duplicates.length && query.confirm !== "true") return res.status(409).json({ error: { code: "POSSIBLE_DUPLICATE", message_en: "A similar patient already exists." }, matches: duplicates.map(presentPatient) });
  const patient = await Patient.create({ ...encryptPatientFields(data), createdBy: req.user!.id });
  res.status(201).json({ patient: presentPatient(patient) });
} catch (e) { next(e); } };
export const listPatients: RequestHandler = async (req, res, next) => { try {
  const query = patientListQuerySchema.parse(req.query);
  const filter: Record<string, unknown> = { ...(query.mandal ? { mandal: query.mandal } : {}), active: true };
  if (query.search) filter.nameNormalized = { $regex: query.search.normalize("NFKC").toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
  if (req.user!.role === "district_admin") {
    const permitted = await permittedDashboardMandals(req.user!);
    if (!permitted?.length) return res.json({ patients: [] });
    const mandals = await Mandal.find({ _id: { $in: permitted } }).select("name name_en name_te name_hi code").lean();
    filter.$and = [{ $or: [{ mandalId: { $in: permitted } }, { mandal: { $in: mandals.flatMap((mandal) => [mandal.name, mandal.name_en, mandal.name_te, mandal.name_hi, mandal.code, String(mandal._id)].filter(Boolean)) } }] }];
  }
  const rows = await Patient.find(filter).sort({ createdAt: -1 }).limit(100);
  const visible = req.user!.role === "system_admin" || req.user!.role === "district_admin" ? rows : rows.filter((patient) => patientIsAssigned(patient, req.user!));
  res.json({ patients: visible.map(presentPatient) });
} catch (e) { next(e); } };
export const getOwnPatient: RequestHandler = async (req, res, next) => { try {
  if (req.user!.role !== "patient" || !req.user!.phone) return res.status(403).json({ error: { code: "FORBIDDEN", message_en: "Patient account access is required." } });
  const patients = await Patient.find({ phoneHash: { $in: phoneHashVariants(req.user!.phone) }, active: true }).limit(2);
  if (patients.length !== 1) return res.status(patients.length ? 409 : 404).json({ error: { code: patients.length ? "PATIENT_LINK_AMBIGUOUS" : "NOT_FOUND", message_en: patients.length ? "Contact your care team to resolve the patient record." : "No patient record is linked to this account." } });
  res.json({ patient: presentPatient(patients[0]) });
} catch (e) { next(e); } };
export const getPatient: RequestHandler = async (req, res, next) => { try { const patient = await Patient.findById(req.params.patientId); if (!patient) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Patient not found." } }); res.json({ patient: presentPatient(patient) }); } catch (e) { next(e); } };
export const updatePatient: RequestHandler = async (req, res, next) => { try {
  const parsed = patientSchema.partial().extend({ version: z.coerce.number().int().positive().optional() }).parse(req.body);
  const { version, ...data } = parsed;
  const existing = await Patient.findById(req.params.patientId).select("createdBy mandal mandalId phcId villageId habitationId");
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Patient not found." } });
  const destination = {
    mandal: data.mandal ?? existing.mandal,
    mandalId: data.mandalId ?? existing.mandalId?.toString(),
    phcId: data.phcId ?? existing.phcId?.toString(),
    villageId: data.villageId ?? existing.villageId?.toString(),
    habitationId: data.habitationId ?? existing.habitationId?.toString()
  };
  const locationChanged =
    (data.mandalId !== undefined ? data.mandalId !== existing.mandalId?.toString() : data.mandal !== undefined && data.mandal.toLocaleLowerCase() !== existing.mandal.toLocaleLowerCase()) ||
    (data.phcId !== undefined && data.phcId !== existing.phcId?.toString()) ||
    (data.villageId !== undefined && data.villageId !== existing.villageId?.toString()) ||
    (data.habitationId !== undefined && data.habitationId !== existing.habitationId?.toString());
  if (locationChanged && !await userCanAccessPatientLocation(destination, req.user!)) return res.status(403).json({ error: { code: "OUT_OF_SCOPE", message_en: "The updated location must remain within your assigned area." } });
  const patient = await Patient.findOneAndUpdate({ _id: req.params.patientId, version: version ?? 1 }, { ...encryptPatientFields(data), $inc: { version: 1 } }, { new: true });
  if (!patient) return res.status(409).json({ error: { code: "VERSION_CONFLICT", message_en: "Patient was changed; reload and retry." } });
  res.json({ patient: presentPatient(patient) });
} catch (e) { next(e); } };
export const linkAbha: RequestHandler = (_req, res) => res.status(503).json({ error: { code: "ABHA_VERIFICATION_UNAVAILABLE", message_en: "ABHA linking requires a configured verification provider." } });
export const createConsent: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      purpose: z.enum(["registration", "screening", "imaging", "location", "telemedicine", "teleconsultation", "data_sharing", "data_processing", "external_ai", "examination", "abha_linking"]),
      granted: z.boolean(),
      consentVersion: z.string().max(80).optional(),
      expiresAt: z.coerce.date().optional()
    }).strict().parse(req.body);
    if (body.purpose === "external_ai") {
      if (req.user?.role !== "patient" || !req.user.phone || !await Patient.exists({
        _id: req.params.patientId,
        phoneHash: { $in: phoneHashVariants(req.user.phone) },
        active: true
      })) {
        return res.status(403).json({ error: { code: "PATIENT_CONSENT_REQUIRED", message_en: "Only the patient can grant or withdraw external AI image-processing consent." } });
      }
    }
    const consent = await Consent.findOneAndUpdate(
      { patient: req.params.patientId, purpose: body.purpose },
      { granted: body.granted, grantedBy: req.user!.id, consentVersion: body.consentVersion, expiresAt: body.expiresAt },
      { upsert: true, new: true }
    );
    res.status(201).json({ consent });
  } catch (e) { next(e); }
};
export const getConsent: RequestHandler = async (req, res, next) => { try { const purpose = z.enum(["registration", "screening", "imaging", "location", "telemedicine", "teleconsultation", "data_sharing", "data_processing", "external_ai", "examination", "abha_linking"]).parse(req.params.purpose); const consent = await Consent.findOne({ patient: req.params.patientId, purpose }); res.json({ granted: Boolean(consent?.granted && (!consent.expiresAt || consent.expiresAt > new Date())), consentVersion: consent?.consentVersion ?? null }); } catch (e) { next(e); } };
export const registerMember: RequestHandler = async (req, res, next) => { try { const body = z.object({ memberId: z.string().regex(/^[a-f\d]{24}$/i), relation: z.string().min(1).max(80) }).strict().parse(req.body); const link = await FamilyLink.create({ patient: req.params.patientId, member: body.memberId, relation: body.relation }); res.status(201).json({ link }); } catch (e) { next(e); } };
export const issueToken: RequestHandler = async (req, res, next) => { try { const body = z.object({ mandal: z.string().min(1).max(80) }).strict().parse(req.body); const mandal = body.mandal.replace(/[^A-Za-z]/g, "").toUpperCase().padEnd(3, "X").slice(0, 3); const year = new Date().getUTCFullYear(); const latest = await Token.findOne({ mandal, year }).sort({ sequence: -1 }); const sequence = (latest?.sequence || 0) + 1; const token = await Token.create({ patient: req.params.patientId, mandal, year, sequence, token: `AD-${mandal}-${year}-${String(sequence).padStart(6, "0")}` }); res.status(201).json({ token: token.token }); } catch (e) { next(e); } };
export const slip: RequestHandler = async (req, res) => {
  const token = await Token.findOne({ patient: req.params.patientId }).sort({ createdAt: -1 });
  if (!token) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Token not found." } });
  const qr = await QRCode.toDataURL(`opaque:${token._id.toString()}`);
  const document = new PDFDocument({ size: "A4", margin: 48 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${token.token}.pdf"`);
  document.pipe(res);
  document.fontSize(18).text("Aarogya Drishti / ఆరోగ్య దృష్టి / आरोग्य दृष्टि");
  document.moveDown().fontSize(13).text("SIMULATION - NOT FOR CLINICAL USE");
  document.moveDown().fontSize(16).text(`Token number: ${token.token}`);
  document.fontSize(10).text("This slip uses synthetic data and does not provide a diagnosis.");
  document.image(Buffer.from(qr.replace(/^data:image\/png;base64,/, ""), "base64"), { fit: [120, 120] });
  document.end();
};
export const extractAarogyasri: RequestHandler = async (req, res, next) => { try { if (!req.file) return res.status(400).json({ error: { code: "FILE_REQUIRED", message_en: "Upload an image or PDF." } }); const processed = await processUpload(req.file.buffer, req.file.mimetype); res.json({ editable: true, saved: false, fileType: processed.mimeType, result: { beneficiaryName: "", cardNumber: "", scheme: "Aarogyasri", confidence: 0 } }); } catch (error) { next(error); } };
export const patientIdentifier = (value: string, patient: string, type: string) => PatientIdentifier.create({ patient, type, valueHash: hashIdentifier(value) });
