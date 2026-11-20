import type { RequestHandler } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Case } from "../models/Case.js";
import { Review } from "../models/Review.js";
import { Referral } from "../models/Referral.js";
import { Investigation } from "../models/Investigation.js";
import { Report } from "../models/Report.js";
import { Diagnosis } from "../models/Diagnosis.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Habit } from "../models/Habit.js";
import { SlaRule } from "../models/SlaRule.js";
import { AuditLog } from "../models/AuditLog.js";
import { Appointment } from "../models/Appointment.js";
import { Hospital } from "../models/Geo.js";
import { Patient } from "../models/Patient.js";
import { Prescription } from "../models/Prescription.js";
import { User } from "../models/User.js";
import { CaseImage } from "../models/CaseImage.js";
import { Symptom } from "../models/Symptom.js";
import { env } from "../config/env.js";
import { transitionCase, transitionInvestigation } from "../services/doctorFlowService.js";
import { decryptBuffer, encryptBuffer } from "../services/encryption.js";
import { cloudinarySignedUrl, expiry, hashBuffer, localFile, processUpload, saveLocal, uploadCloudinary } from "../services/mediaService.js";
import { queueWorkflowNotification } from "../services/workflowNotificationService.js";

const fail = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) => res.status(status).json({ error: { code, message_en, message_te: "చెల్లని అభ్యర్థన.", message_hi: "अमान्य अनुरोध।" } });
const caseId = z.string().min(1);
const reviewInput = z.object({ decision: z.enum(["agree", "disagree", "defer"]), reason: z.string().min(3).max(5000), findings: z.string().max(10000).optional(), aiAgreement: z.enum(["agree", "disagree", "not_applicable"]) });
const transitionInput = z.object({ status: z.string().min(1) });

export const reviewQueue: RequestHandler = async (req, res, next) => {
  try {
    const assignments = req.user!.assignments ?? [];
    const patientConditions: Record<string, unknown>[] = [{ createdBy: req.user!.id }];
    for (const assignment of assignments) {
      if (assignment.mandal) patientConditions.push( /^[a-f\d]{24}$/i.test(assignment.mandal) ? { $or: [{ mandalId: assignment.mandal }, { mandal: assignment.mandal }] } : { mandal: assignment.mandal });
      if (assignment.phc && /^[a-f\d]{24}$/i.test(assignment.phc)) patientConditions.push({ phcId: assignment.phc });
      if (assignment.habitation && /^[a-f\d]{24}$/i.test(assignment.habitation)) patientConditions.push({ habitationId: assignment.habitation });
    }
    const patientIds = await Patient.distinct("_id", { $or: patientConditions });
    const appointmentFilter = { clinician: req.user!.id, status: { $ne: "cancelled" } };
    const [appointmentCaseIds, appointmentPatientIds] = req.user!.role === "doctor" ? await Promise.all([
      Appointment.distinct("case", { ...appointmentFilter, case: { $exists: true, $ne: null } }),
      Appointment.distinct("patient", appointmentFilter)
    ]) : [[], []];
    const related = [
      ...(patientIds.length ? [{ patient: { $in: patientIds } }] : []),
      ...(appointmentCaseIds.length ? [{ _id: { $in: appointmentCaseIds } }] : []),
      ...(appointmentPatientIds.length ? [{ patient: { $in: appointmentPatientIds } }] : [])
    ];
    const cases = related.length ? await Case.find({
      status: { $in: ["submitted", "ai_processed", "in_review", "specialist_review", "urgent_referral"] },
      $or: related
    }).sort({ priorityBand: -1, updatedAt: 1 }).limit(100).populate("patient", "patientCode") : [];
    res.json({ cases });
  } catch (e) { next(e); }
};

export const clinicalSummary: RequestHandler = async (req, res, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
    const item = await Case.findById(id).select("patient status priorityBand riskScore riskFactors notes createdAt updatedAt");
    if (!item) return fail(res, "NOT_FOUND", "Case not found.", 404);

    const [symptoms, habits, images, review] = await Promise.all([
      Symptom.find({ patient: item.patient }).sort({ createdAt: -1 }).limit(20).select("name severity durationDays createdAt"),
      Habit.find({ patient: item.patient }).sort({ createdAt: -1 }).limit(20).select("name frequency quantity unit startedAt stoppedAt createdAt"),
      CaseImage.find({ case: item._id }).sort({ createdAt: -1 }).limit(20).select("qualityStatus createdAt"),
      Review.findOne({ case: item._id }).sort({ version: -1 }).select("decision reason findings signedAt createdAt version")
    ]);

    await AuditLog.create({
      actor: req.user!.id,
      action: "clinical_summary_viewed",
      resource: "ClinicalCaseSummary",
      resourceId: item._id.toString(),
      metadata: { aiGenerated: false, symptomCount: symptoms.length, habitCount: habits.length, imageCount: images.length }
    });

    res.setHeader("Cache-Control", "no-store");
    res.json({
      summary: {
        generatedAt: new Date().toISOString(),
        generationMethod: "structured_record_summary",
        aiGenerated: false,
        case: {
          id: item._id.toString(),
          status: item.status,
          workflowPriority: item.priorityBand ?? null,
          notes: item.notes ?? "",
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        },
        patientHistory: {
          association: "patient_profile; reporter not recorded; not linked to this specific case",
          symptoms: symptoms.map((symptom) => ({
            name: symptom.name,
            severity: symptom.severity,
            durationDays: symptom.durationDays,
            reportedAt: symptom.createdAt
          })),
          habits: habits.map((habit) => ({
            name: habit.name,
            frequency: habit.frequency,
            quantity: habit.quantity,
            unit: habit.unit,
            startedAt: habit.startedAt,
            stoppedAt: habit.stoppedAt,
            reportedAt: habit.createdAt
          }))
        },
        recordedRiskIndicators: {
          score: item.riskScore ?? null,
          factors: item.riskFactors.map((factor: { rule: string; evidence?: string }) => ({ rule: factor.rule, evidence: factor.evidence })),
          disclaimer: "Recorded rule-based indicators are not a validated clinical risk assessment."
        },
        imageHistory: images.map((image) => ({ qualityStatus: image.qualityStatus, uploadedAt: image.createdAt })),
        doctorAssessment: review ? {
          status: review.signedAt ? "signed" : "pending_signature",
          decision: review.decision,
          reason: review.reason,
          findings: review.findings ?? "",
          reviewedAt: review.signedAt ?? review.createdAt
        } : { status: "not_reviewed" },
        aiSummary: { status: "unavailable", reason: "NO_VALIDATED_CLINICAL_MODEL", aiGenerated: false },
        disclaimer: "Structured summary of recorded information only. Not a diagnosis or treatment recommendation. A qualified clinician must independently assess the patient."
      }
    });
  } catch (error) { next(error); }
};

export const reviewCase: RequestHandler = async (req, res, next) => {
  try {
    const body = reviewInput.parse(req.body);
    const item = await Case.findById(caseId.parse(req.params.id));
    if (!item) return fail(res, "NOT_FOUND", "Case not found.", 404);
    if (!["in_review", "ai_processed", "submitted"].includes(item.status)) return fail(res, "INVALID_CASE_STATE", "This case is not available for review.", 409);
    if (["submitted", "ai_processed"].includes(item.status)) await transitionCase(item._id.toString(), "in_review", req.user!);
    const latest = await Review.findOne({ case: item._id }).sort({ version: -1 });
    const review = await Review.create({ ...body, case: item._id, reviewer: req.user!.id, version: (latest?.version ?? 0) + 1 });
    await transitionCase(item._id.toString(), body.decision === "defer" ? "deferred" : "clinician_reviewed", req.user!, { reviewId: review._id.toString() });
    await queueWorkflowNotification({ eventKey: `review:${review._id}`, patientId: item.patient.toString(), actorId: req.user!.id, template: "screening_review_completed" });
    res.status(201).json({ review });
  } catch (e) { next(e); }
};

export const recaptureRequest: RequestHandler = async (req, res, next) => {
  try {
    const item = await transitionCase(caseId.parse(req.params.id), "recapture_requested", req.user!);
    await queueWorkflowNotification({ eventKey: `recapture:${item._id}:${item.updatedAt?.getTime() ?? Date.now()}`, patientId: item.patient.toString(), actorId: req.user!.id, template: "screening_recapture_requested" });
    res.json({ case: item });
  } catch (e) { next(e); }
};

export const signReview: RequestHandler = async (req, res, next) => {
  try {
    const id = caseId.parse(req.params.id);
    const review = await Review.findOne({ case: id, reviewer: req.user!.id }).sort({ version: -1 });
    if (!review) return fail(res, "NOT_FOUND", "Review not found.", 404);
    if (review.signedAt) return fail(res, "ALREADY_SIGNED", "Signed reviews cannot be edited.", 409);
    review.signedAt = new Date();
    await review.save();
    await AuditLog.create({ actor: req.user!.id, action: "sign", resource: "Review", resourceId: review._id.toString() });
    res.json({ review });
  } catch (e) { next(e); }
};

export const createReferral: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ caseId: z.string().optional(), toSpecialty: z.string().trim().min(1).max(120), hospital: z.string().regex(/^[a-f\d]{24}$/i), priority: z.enum(["routine", "urgent"]), reason: z.string().trim().min(3).max(5000) }).strict().parse(req.body);
    const item = await Case.findById(caseId.parse(body.caseId ?? String(req.params.id))); if (!item) return fail(res, "NOT_FOUND", "Case not found.", 404);
    const profile = await DoctorProfile.findOne({ user: req.user!.id }).select("hospital");
    const [sourceHospital, destinationHospital] = await Promise.all([
      profile?.hospital ? Hospital.findOne({ _id: profile.hospital, active: true }).select("_id") : null,
      Hospital.findOne({ _id: body.hospital, active: true }).select("_id")
    ]);
    if (!sourceHospital) return fail(res, "SOURCE_HOSPITAL_REQUIRED", "An active source hospital assignment is required to create a referral.", 409);
    if (!destinationHospital) return fail(res, "DESTINATION_UNAVAILABLE", "The destination hospital is not active or does not exist.", 404);
    if (sourceHospital._id.equals(destinationHospital._id)) return fail(res, "DESTINATION_MUST_DIFFER", "Choose a different destination hospital.", 400);
    const referral = await Referral.create({
      case: item._id,
      fromUser: req.user!.id,
      sourceHospital: sourceHospital._id,
      hospital: destinationHospital._id,
      toSpecialty: body.toSpecialty,
      priority: body.priority,
      reason: body.reason,
      referralCode: `AD-R-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      status: "requested"
    });
    await transitionCase(item._id.toString(), body.priority === "urgent" ? "urgent_referral" : "specialist_review", req.user!, { referralId: referral._id.toString() });
    await AuditLog.create({ actor: req.user!.id, action: "referral_created", resource: "Referral", resourceId: referral._id.toString(), metadata: { status: referral.status, priority: referral.priority } });
    await queueWorkflowNotification({ eventKey: `referral:${referral._id}:created`, patientId: item.patient.toString(), actorId: req.user!.id, template: "referral_created" });
    res.status(201).json({ referral });
  } catch (e) { next(e); }
};

export const updateReferral: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["accepted", "scheduled", "completed", "cancelled"]), appointmentId: z.string().regex(/^[a-f\d]{24}$/i).optional(), appointmentDetails: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    const referral = await Referral.findById(req.params.id);
    if (!referral) return fail(res, "NOT_FOUND", "Referral not found.", 404);
    const doctorProfile = await DoctorProfile.findOne({ user: req.user!.id }).select("hospital");
    const canManage = referral.fromUser.toString() === req.user!.id || doctorProfile?.hospital?.toString() === referral.hospital.toString();
    if (!canManage) return fail(res, "FORBIDDEN", "Only the referring doctor or a doctor assigned to the destination hospital may update this referral.", 403);
    const allowed: Record<string, string[]> = { requested: ["accepted", "cancelled"], accepted: ["scheduled", "cancelled"], scheduled: ["completed", "cancelled"], completed: [], cancelled: [] };
    if (!allowed[referral.status]?.includes(body.status)) return fail(res, "INVALID_REFERRAL_TRANSITION", "This referral status transition is not allowed.", 409);
    if (body.appointmentId) {
      const appointment = await Appointment.findOne({ _id: body.appointmentId, case: referral.case, patient: (await Case.findById(referral.case))?.patient, hospital: referral.hospital });
      if (!appointment) return fail(res, "APPOINTMENT_MISMATCH", "The appointment must belong to this patient, case, and destination hospital.", 400);
      referral.appointment = appointment._id;
    }
    if (body.status === "scheduled" && !body.appointmentId && !referral.appointment && !body.appointmentDetails) return fail(res, "APPOINTMENT_REQUIRED", "Provide a matching appointment or appointment details before scheduling.", 400);
    if (body.appointmentDetails !== undefined) referral.appointmentDetails = body.appointmentDetails;
    referral.status = body.status;
    await referral.save();
    await AuditLog.create({ actor: req.user!.id, action: "edit", resource: "Referral", resourceId: req.params.id, metadata: body });
    const patient = await Case.findById(referral.case).select("patient");
    if (patient) await queueWorkflowNotification({ eventKey: `referral:${referral._id}:${body.status}`, patientId: patient.patient.toString(), actorId: req.user!.id, template: "referral_updated" });
    res.json({ referral });
  } catch (e) { next(e); }
};

export const createInvestigation: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ caseId: z.string().optional(), type: z.enum(["biopsy", "histopathology", "ct", "mri"]) }).parse(req.body);
    const item = await Case.findById(caseId.parse(body.caseId ?? String(req.params.id))); if (!item) return fail(res, "NOT_FOUND", "Case not found.", 404);
    const investigation = await Investigation.create({ ...body, case: item._id });
    if (["routine_follow_up", "specialist_review", "urgent_referral"].includes(item.status)) await transitionCase(item._id.toString(), "investigation_advised", req.user!, { investigationId: investigation._id.toString() });
    res.status(201).json({ investigation });
  } catch (e) { next(e); }
};

export const updateInvestigation: RequestHandler = async (req, res, next) => {
  try {
    const body = transitionInput.parse(req.body);
    const investigation = await transitionInvestigation(String(req.params.id), body.status as never, req.user!);
    res.json({ investigation });
  } catch (e) { next(e); }
};

export const createReport: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ summary: z.string().min(3).max(10000), media: z.string().optional(), reviewed: z.boolean().optional() }).parse(req.body);
    const investigation = await Investigation.findById(String(req.params.id)); if (!investigation) return fail(res, "NOT_FOUND", "Investigation not found.", 404);
    const report = await Report.create({ investigation: investigation._id, summary: body.summary, media: body.media, uploadedBy: req.user!.id, ...(body.reviewed ? { reviewedBy: req.user!.id, reviewedAt: new Date() } : {}) });
    await transitionInvestigation(String(req.params.id), "report_received", req.user!);
    res.status(201).json({ report });
  } catch (e) { next(e); }
};

export const caseInvestigations: RequestHandler = async (req, res, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
    const investigations = await Investigation.find({ case: id }).sort({ createdAt: -1 }).lean();
    const reports = await Report.find({ investigation: { $in: investigations.map((item) => item._id) } })
      .sort({ createdAt: -1 })
      .select("investigation summary reviewedAt createdAt")
      .lean();
    res.json({
      investigations: investigations.map((item) => ({
        ...item,
        reports: reports.filter((report) => String(report.investigation) === String(item._id))
      }))
    });
  } catch (e) { next(e); }
};

export const createDiagnosis: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ category: z.enum(["screen_positive_abnormality", "clinical_suspicion", "precancer", "pathology_confirmed_malignancy", "no_abnormality_clinically"]), evidenceReport: z.string().optional() }).parse(req.body);
    if (req.user!.role !== "doctor") return fail(res, "FORBIDDEN", "Only doctors can enter diagnoses.", 403);
    const latest = await Diagnosis.findOne({ case: req.params.id }).sort({ version: -1 });
    const diagnosis = await Diagnosis.create({ ...body, case: req.params.id, enteredBy: req.user!.id, version: (latest?.version ?? 0) + 1 });
    await AuditLog.create({ actor: req.user!.id, action: "edit", resource: "Diagnosis", resourceId: diagnosis._id.toString(), metadata: { category: body.category } });
    res.status(201).json({ diagnosis });
  } catch (e) { next(e); }
};

const prescriptionInput = z.object({
  patientId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  medicineName: z.string().trim().min(1).max(160),
  dosage: z.string().trim().min(1).max(160),
  prescriptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  notes: z.string().trim().max(1000).optional()
}).strict();

export const patientPrescriptions: RequestHandler = async (req, res, next) => {
  try {
    const patientId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.patientId);
    const prescriptions = await Prescription.find({ patient: patientId, isDemoData: { $ne: true } }).sort({ prescriptionDate: -1, createdAt: -1 }).limit(100).lean();
    res.json({ prescriptions });
  } catch (e) { next(e); }
};

export const createPatientPrescription: RequestHandler = async (req, res, next) => {
  try {
    const body = prescriptionInput.parse(req.body);
    const patientId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.patientId ?? body.patientId);
    if (body.prescriptionDate > new Date().toISOString().slice(0, 10)) {
      return fail(res, "INVALID_PRESCRIPTION_DATE", "Prescription date cannot be in the future.", 400);
    }
    const [patient, doctor] = await Promise.all([
      Patient.findOne({ _id: patientId, active: true }).select("_id"),
      User.findById(req.user!.id).select("name")
    ]);
    if (!patient) return fail(res, "NOT_FOUND", "Patient not found.", 404);
    const approvedAt = new Date();
    const prescription = await Prescription.create({
      medicineName: body.medicineName,
      dosage: body.dosage,
      prescriptionDate: body.prescriptionDate,
      notes: body.notes,
      doctor: doctor?.name ?? "Clinician",
      doctorUser: req.user!.id,
      patient: patient._id,
      source: "clinician",
      status: "active",
      approvedBy: req.user!.id,
      approvedAt,
      createdBy: req.user!.id
    });
    await AuditLog.create({
      actor: req.user!.id,
      action: "prescription.created",
      resource: "Prescription",
      resourceId: prescription._id.toString(),
      metadata: { patientId: patient._id.toString(), source: "clinician" }
    });
    await queueWorkflowNotification({
      eventKey: `prescription:${prescription._id}:issued`,
      patientId: patient._id.toString(),
      actorId: req.user!.id,
      template: "prescription_issued"
    });
    res.status(201).json({ prescription });
  } catch (e) { next(e); }
};

const availabilityInput = z.object({
  start: z.coerce.date(),
  end: z.coerce.date()
}).strict().refine((value) => value.end > value.start, "Schedule end must be after start.");
type AvailabilityWindow = {
  _id: { toString(): string };
  start: Date;
  end: Date;
  booked?: boolean;
  bookings?: Array<{ start: Date; end: Date }>;
};

export const doctorAvailability: RequestHandler = async (req, res, next) => {
  try {
    const profile = await DoctorProfile.findOne({ user: req.user!.id }).select("availability");
    if (!profile) return fail(res, "DOCTOR_PROFILE_NOT_FOUND", "Doctor profile was not found.", 404);
    const slots = (profile.availability as unknown as AvailabilityWindow[])
      .filter((slot) => slot.start > new Date())
      .map((slot) => ({
        id: slot._id.toString(),
        start: slot.start,
        end: slot.end,
        booked: Boolean(slot.booked || slot.bookings?.length)
      }));
    res.json({ slots });
  } catch (e) { next(e); }
};

export const addOwnDoctorAvailability: RequestHandler = async (req, res, next) => {
  try {
    const body = availabilityInput.safeParse(req.body);
    if (!body.success || body.data.start <= new Date()) {
      return fail(res, "INVALID_SCHEDULE", "Choose a future schedule interval with an end after its start.", 400);
    }
    const profile = await DoctorProfile.findOne({ user: req.user!.id });
    if (!profile) return fail(res, "DOCTOR_PROFILE_NOT_FOUND", "Doctor profile was not found.", 404);
    const slots = profile.availability as unknown as AvailabilityWindow[];
    const overlapsSchedule = slots.some((slot) => slot.start < body.data.end && slot.end > body.data.start);
    const overlapsAppointment = await Appointment.exists({
      clinician: req.user!.id,
      status: { $in: ["requested", "confirmed", "rescheduled"] },
      startAt: { $lt: body.data.end },
      endAt: { $gt: body.data.start }
    });
    if (overlapsSchedule || overlapsAppointment) {
      return fail(res, "SCHEDULE_CONFLICT", "The schedule overlaps an existing schedule or appointment.", 409);
    }
    profile.availability.push({ ...body.data, booked: false, bookings: [] });
    await profile.save();
    const slot = profile.availability[profile.availability.length - 1] as unknown as AvailabilityWindow;
    await AuditLog.create({ actor: req.user!.id, action: "doctor.availability.created", resource: "doctor_availability", resourceId: slot._id.toString() });
    res.status(201).json({ slot: { id: slot._id.toString(), start: slot.start, end: slot.end, booked: false } });
  } catch (e) { next(e); }
};

export const removeOwnDoctorAvailability: RequestHandler = async (req, res, next) => {
  try {
    const slotId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.slotId);
    const profile = await DoctorProfile.findOne({ user: req.user!.id });
    if (!profile) return fail(res, "DOCTOR_PROFILE_NOT_FOUND", "Doctor profile was not found.", 404);
    const slots = profile.availability as unknown as AvailabilityWindow[];
    const slot = slots.find((item) => item._id.toString() === slotId);
    if (!slot) return fail(res, "SCHEDULE_NOT_FOUND", "Schedule slot was not found.", 404);
    const appointmentExists = await Appointment.exists({
      clinician: req.user!.id,
      availabilityId: slotId,
      status: { $in: ["requested", "confirmed", "rescheduled"] }
    });
    if (slot.booked || slot.bookings?.length || slot.start <= new Date() || appointmentExists) {
      return fail(res, "SCHEDULE_NOT_REMOVABLE", "Booked or past schedule intervals cannot be removed.", 409);
    }
    profile.availability.pull({ _id: slotId });
    await profile.save();
    await AuditLog.create({ actor: req.user!.id, action: "doctor.availability.deleted", resource: "doctor_availability", resourceId: slotId });
    res.status(204).send();
  } catch (e) { next(e); }
};

const doctorProfileInput = z.object({
  registrationNo: z.string().trim().min(2).max(80),
  registrationAuthority: z.string().trim().min(2).max(160),
  specialty: z.string().trim().min(2).max(120),
  hospitalName: z.string().trim().max(160).optional(),
  qualification: z.string().trim().min(2).max(200),
  experienceYears: z.coerce.number().int().min(0).max(70),
  professionalSummary: z.string().trim().max(2000).optional()
}).strict();
const professionalDocumentType = z.enum(["registration_certificate", "qualification", "experience_certificate", "identity", "other"]);
type DoctorDocumentView = {
  _id: { toString(): string };
  type: string;
  originalName: string;
  mimeType?: string;
  size: number;
  reviewStatus: string;
  adminRemarks?: string;
  uploadedAt: Date;
  verifiedAt?: Date;
};
const documentDownloadName = (document: Pick<DoctorDocumentView, "originalName" | "mimeType">) =>
  document.mimeType === "image/jpeg" && /\.png$/i.test(document.originalName)
    ? `${document.originalName.slice(0, -4)}.jpg`
    : document.originalName;
const publicDoctorDocument = (document: DoctorDocumentView) => ({
  id: String(document._id),
  type: document.type,
  originalName: document.originalName,
  downloadName: documentDownloadName(document),
  size: document.size,
  reviewStatus: document.reviewStatus === "accepted" ? "approved" : document.reviewStatus,
  adminRemarks: document.adminRemarks,
  uploadedAt: document.uploadedAt,
  verifiedAt: document.verifiedAt
});
const publicDoctorProfile = (profile: InstanceType<typeof DoctorProfile>) => {
  const raw = profile.toObject();
  return {
    id: String(raw._id),
    registrationNo: raw.registrationNo,
    registrationAuthority: raw.registrationAuthority,
    specialty: raw.specialty,
    hospitalName: raw.hospitalName,
    qualification: raw.qualification,
    experienceYears: raw.experienceYears,
    professionalSummary: raw.professionalSummary,
    hospital: raw.hospital,
    verificationStatus: raw.verificationStatus,
    submittedAt: raw.submittedAt,
    verificationHistory: raw.verificationHistory,
    documents: raw.documents.map((document: DoctorDocumentView) => publicDoctorDocument(document))
  };
};

export const doctorProfile: RequestHandler = async (req, res, next) => {
  try {
    const profile = await DoctorProfile.findOne({ user: req.user!.id }).populate("hospital", "name");
    res.json({ profile: profile ? publicDoctorProfile(profile) : null });
  } catch (e) { next(e); }
};

export const updateDoctorProfile: RequestHandler = async (req, res, next) => {
  try {
    const body = doctorProfileInput.parse(req.body);
    let profile = await DoctorProfile.findOne({ user: req.user!.id });
    if (profile && !["draft", "rejected"].includes(profile.verificationStatus)) return fail(res, "PROFILE_LOCKED", "A submitted or verified profile cannot be edited.", 409);
    if (!profile) profile = new DoctorProfile({ user: req.user!.id, verificationStatus: "draft" });
    profile.registrationNo = body.registrationNo.toUpperCase();
    profile.registrationAuthority = body.registrationAuthority;
    profile.specialty = body.specialty;
    if (body.hospitalName !== undefined) profile.hospitalName = body.hospitalName;
    profile.qualification = body.qualification;
    profile.experienceYears = body.experienceYears;
    profile.professionalSummary = body.professionalSummary;
    profile.verificationStatus = "draft";
    await profile.save();
    res.json({ profile: publicDoctorProfile(profile) });
  } catch (e) { next(e); }
};

export const uploadDoctorDocument: RequestHandler = async (req, res, next) => {
  try {
    if (!req.file) return fail(res, "FILE_REQUIRED", "Upload a PDF or image document.", 400);
    const type = professionalDocumentType.parse(req.body.type);
    const uploadId = z.string().uuid().parse(req.body.uploadId).toLowerCase();
    const profile = await DoctorProfile.findOne({ user: req.user!.id });
    if (!profile) return fail(res, "DOCTOR_PROFILE_NOT_FOUND", "Doctor profile was not found.", 404);
    if (!["draft", "rejected"].includes(profile.verificationStatus)) return fail(res, "PROFILE_LOCKED", "Documents cannot be changed while verification is pending or approved.", 409);
    const originalExtension = path.extname(req.file.originalname).toLowerCase();
    const validExtensions: Record<string, string[]> = {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"]
    };
    if (!validExtensions[req.file.mimetype]?.includes(originalExtension)) {
      return fail(res, "INVALID_FILE_TYPE", "The filename extension must match the uploaded PDF, JPG, or PNG file.", 400);
    }
    const processed = await processUpload(req.file.buffer, req.file.mimetype);
    const sha256 = hashBuffer(processed.buffer);
    const existing = profile.documents.find((document: { uploadId?: string; sha256: string; type: string }) => document.uploadId === uploadId);
    if (existing) {
      if (existing.sha256 !== sha256 || existing.type !== type) return fail(res, "UPLOAD_ID_REUSED", "This upload identifier was already used for a different file or document type.", 409);
      return res.status(200).json({ document: publicDoctorDocument(existing as unknown as DoctorDocumentView) });
    }
    const extension = processed.mimeType === "application/pdf" ? "pdf" : "jpg";
    const key = `doctors/${req.user!.id}/${sha256}-${uploadId}.${extension}`;
    const configuredCloudinary = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
    const storageKey = configuredCloudinary ? await uploadCloudinary(processed.buffer, key, processed.mimeType) : key;
    if (!configuredCloudinary) await saveLocal(encryptBuffer(processed.buffer), key);
    const originalName = path.basename(req.file.originalname.replace(/\\/g, "/"))
      .split("")
      .map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? "_" : character)
      .join("")
      .slice(0, 255);
    const savedProfile = await DoctorProfile.findOneAndUpdate(
      { user: req.user!.id, verificationStatus: { $in: ["draft", "rejected"] }, "documents.uploadId": { $ne: uploadId } },
      {
        $push: {
          documents: {
            type,
            originalName,
            mimeType: processed.mimeType,
            size: processed.buffer.length,
            sha256,
            uploadId,
            storage: configuredCloudinary ? "cloudinary" : "local",
            storageKey,
            encryptedAtRest: !configuredCloudinary,
            reviewStatus: "uploaded",
            uploadedAt: new Date()
          }
        }
      },
      { new: true, runValidators: true }
    );
    if (!savedProfile) {
      const latestProfile = await DoctorProfile.findOne({ user: req.user!.id });
      const repeatedUpload = latestProfile?.documents.find((document: { uploadId?: string; sha256: string; type: string }) => document.uploadId === uploadId);
      if (repeatedUpload) {
        if (repeatedUpload.sha256 !== sha256 || repeatedUpload.type !== type) return fail(res, "UPLOAD_ID_REUSED", "This upload identifier was already used for a different file or document type.", 409);
        return res.status(200).json({ document: publicDoctorDocument(repeatedUpload as unknown as DoctorDocumentView) });
      }
      if (!latestProfile) return fail(res, "DOCTOR_PROFILE_NOT_FOUND", "Doctor profile was not found.", 404);
      return fail(res, "PROFILE_LOCKED", "Documents cannot be changed while verification is pending or approved.", 409);
    }
    const savedDocument = savedProfile.documents.find((document: { uploadId?: string }) => document.uploadId === uploadId);
    if (!savedDocument) return fail(res, "DOCUMENT_SAVE_FAILED", "The uploaded document was not saved to your profile.", 500);
    res.status(201).json({ document: publicDoctorDocument(savedDocument as unknown as DoctorDocumentView) });
  } catch (e) { next(e); }
};

export const submitDoctorProfile: RequestHandler = async (req, res, next) => {
  try {
    const profile = await DoctorProfile.findOne({ user: req.user!.id });
    if (!profile) return fail(res, "DOCTOR_PROFILE_NOT_FOUND", "Doctor profile was not found.", 404);
    if (!["draft", "rejected"].includes(profile.verificationStatus)) return fail(res, "INVALID_VERIFICATION_STATE", "This profile cannot be submitted in its current state.", 409);
    if (!profile.registrationNo || !profile.registrationAuthority || !profile.specialty || !profile.qualification || profile.experienceYears === undefined) {
      return fail(res, "PROFILE_INCOMPLETE", "Complete all professional profile fields before submission.", 400);
    }
    const documentTypes = new Set(profile.documents.filter((document: { reviewStatus: string }) => document.reviewStatus !== "rejected").map((document: { type: string }) => document.type));
    const missingTypes = [
      ...(!documentTypes.has("registration_certificate") ? ["registration_certificate"] : []),
      ...(!documentTypes.has("qualification") ? ["qualification"] : [])
    ];
    if (missingTypes.length) {
      const missingLabels = missingTypes.map((type) => type === "registration_certificate" ? "professional registration certificate" : "qualification document");
      const message = `Upload the missing ${missingLabels.join(" and ")}${missingLabels.length === 1 ? "" : "s"} before submitting.`;
      return res.status(400).json({ error: { code: "DOCUMENTS_INCOMPLETE", message_en: message, missingDocumentTypes: missingTypes } });
    }
    const submittedAt = new Date();
    const submittedProfile = await DoctorProfile.findOneAndUpdate(
      {
        user: req.user!.id,
        verificationStatus: { $in: ["draft", "rejected"] },
        "documents": {
          $all: [
            { $elemMatch: { type: "registration_certificate", reviewStatus: { $ne: "rejected" } } },
            { $elemMatch: { type: "qualification", reviewStatus: { $ne: "rejected" } } }
          ]
        }
      },
      {
        $set: {
          verificationStatus: "pending",
          submittedAt,
          "documents.$[uploadedDocument].reviewStatus": "pending"
        }
      },
      { new: true, runValidators: true, arrayFilters: [{ "uploadedDocument.reviewStatus": "uploaded" }] }
    );
    if (!submittedProfile) return fail(res, "INVALID_VERIFICATION_STATE", "The profile or required documents changed while submitting. Reload and try again.", 409);
    await AuditLog.create({ actor: req.user!.id, action: "doctor.verification.submitted", resource: "doctor_profile", resourceId: profile._id.toString(), metadata: { outcome: "success" } });
    res.json({ profile: publicDoctorProfile(submittedProfile) });
  } catch (e) { next(e); }
};

export const downloadDoctorDocument: RequestHandler = async (req, res, next) => {
  try {
    const userId = String(req.params.userId ?? req.user!.id);
    if (req.user!.role !== "system_admin" && req.user!.id !== userId) return fail(res, "FORBIDDEN", "You cannot access this professional document.", 403);
    const profile = await DoctorProfile.findOne({ user: userId });
    const document = profile?.documents.find((item: { _id: { toString(): string }; storageKey: string; storage: string; mimeType: string; encryptedAtRest: boolean; originalName: string }) => String(item._id) === String(req.params.documentId));
    if (!document) return fail(res, "NOT_FOUND", "Professional document not found.", 404);
    if (!new RegExp(`^doctors/${userId}/[a-f\\d]{64}-(?:\\d+|[a-f\\d-]{36})\\.(pdf|jpg)$`, "i").test(document.storageKey)) return fail(res, "INVALID_DOCUMENT_STORAGE", "This professional document cannot be accessed.", 500);
    await AuditLog.create({ actor: req.user!.id, action: "doctor.document.accessed", resource: "doctor_document", resourceId: String(document._id), ip: req.ip, userAgent: req.get("user-agent") });
    let content: Buffer;
    if (document.storage === "cloudinary") {
      const response = await fetch(cloudinarySignedUrl(document.storageKey, expiry(), document.mimeType));
      if (!response.ok) return fail(res, "DOCUMENT_STORAGE_UNAVAILABLE", "The professional document is temporarily unavailable.", 502);
      content = Buffer.from(await response.arrayBuffer());
    } else {
      const stored = await fs.readFile(localFile(document.storageKey));
      content = document.encryptedAtRest ? decryptBuffer(stored) : stored;
    }
    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${documentDownloadName(document).replace(/["\\\r\n]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", content.length);
    res.end(content);
  } catch (e) { next(e); }
};

export const slaRules: RequestHandler = async (_req, res, next) => {
  try { res.json({ rules: await SlaRule.find().sort({ stage: 1 }) }); } catch (e) { next(e); }
};
