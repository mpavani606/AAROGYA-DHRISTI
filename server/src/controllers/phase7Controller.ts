import type { RequestHandler } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { AiInference } from "../models/AiInference.js";
import { Appointment } from "../models/Appointment.js";
import { Case } from "../models/Case.js";
import { CaseImage } from "../models/CaseImage.js";
import { GeminiScreeningObservation } from "../models/GeminiScreeningObservation.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { FollowUp } from "../models/FollowUp.js";
import { Hospital } from "../models/Geo.js";
import { Investigation } from "../models/Investigation.js";
import { Patient } from "../models/Patient.js";
import { Referral } from "../models/Referral.js";
import { Report } from "../models/Report.js";
import { Review } from "../models/Review.js";
import { AuditLog } from "../models/AuditLog.js";
import { patientIsAssigned } from "../middleware/patientCareRelationship.js";
import { queueWorkflowNotification } from "../services/workflowNotificationService.js";
import { isFollowUpOverdue, isFollowUpTransitionAllowed } from "../services/followUpService.js";

const fail = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) =>
  res.status(status).json({ error: { code, message_en } });
const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const followUpStatuses = ["pending", "scheduled", "completed", "missed", "rescheduled", "cancelled"] as const;

const safeFollowUp = (item: InstanceType<typeof FollowUp>, patientView: boolean) => ({
  id: item._id.toString(),
  caseId: item.case.toString(),
  referralId: item.referral?.toString(),
  appointmentId: item.appointment?.toString(),
  ...(patientView ? {} : { assignedTo: item.assignedTo.toString(), notes: item.notes }),
  scheduledAt: item.scheduledAt,
  status: item.status,
  overdue: isFollowUpOverdue(item.status, item.scheduledAt),
  history: item.history.map((entry: { status: string; scheduledAt?: Date; changedAt: Date; changedBy: { toString(): string }; note?: string }) => ({
    status: entry.status,
    scheduledAt: entry.scheduledAt,
    changedAt: entry.changedAt,
    ...(patientView ? {} : { changedBy: entry.changedBy.toString(), note: entry.note })
  })),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt
});

export const careOverview: RequestHandler = async (req, res, next) => {
  try {
    const patientId = idSchema.parse(req.params.id);
    const cases = await Case.find({ patient: patientId }).sort({ createdAt: -1 }).select("_id status priorityBand createdAt updatedAt").limit(100);
    const caseIds = cases.map((item) => item._id);
    const [reviews, inferences, images, observations, referrals, appointments, followUps] = await Promise.all([
      Review.find({ case: { $in: caseIds } }).sort({ version: -1 }).select("case decision signedAt createdAt version"),
      AiInference.find({ case: { $in: caseIds } }).sort({ createdAt: -1 }).populate("model", "name version").select("case image state output metadata createdAt model"),
      CaseImage.find({ case: { $in: caseIds } }).select("case qualityStatus"),
      GeminiScreeningObservation.find({ case: { $in: caseIds } }).sort({ createdAt: -1 }).select("case imageQuality visibleDescription model createdAt"),
      Referral.find({ case: { $in: caseIds } }).sort({ createdAt: -1 }).populate("hospital", "name code").select("case referralCode toSpecialty hospital priority reason status appointment appointmentDetails createdAt"),
      Appointment.find({ patient: patientId }).sort({ startAt: -1 }).populate("hospital", "name").select("case clinician hospital startAt endAt status tokenNo createdAt").limit(100),
      FollowUp.find({ patient: patientId }).sort({ scheduledAt: 1 }).limit(100)
    ]);
    const latestReview = (caseId: string) => reviews.find((review) => review.case.toString() === caseId);
    const latestInference = (caseId: string) => inferences.find((inference) => inference.case.toString() === caseId);
    const caseViews = cases.map((item) => {
      const review = latestReview(item._id.toString());
      const inference = latestInference(item._id.toString());
      const observation = observations.find((entry) => entry.case.toString() === item._id.toString());
      return {
        id: item._id.toString(),
        status: item.status,
        priorityBand: item.priorityBand,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        doctorReview: review ? { status: "reviewed", decision: review.decision, reviewedAt: review.signedAt ?? review.createdAt } : { status: "pending" },
        imageQuality: images.filter((image) => image.case.toString() === item._id.toString()).map((image) => image.qualityStatus),
        aiResult: inference || observation ? {
          category: null,
          processingStatus: observation ? "gemini_observation" : "demo_not_validated",
          clinicallyValidated: false,
          model: inference?.model ?? { name: "Gemini", version: observation?.model },
          processedAt: observation?.createdAt ?? inference?.createdAt,
          observation: observation ? {
            imageQuality: observation.imageQuality,
            visibleDescription: observation.visibleDescription,
            model: observation.model
          } : undefined
        } : {
          category: images.some((image) => image.case.toString() === item._id.toString()) ? "AI_PROCESSING_UNAVAILABLE" : null,
          processingStatus: images.some((image) => image.case.toString() === item._id.toString()) ? "unavailable" : "not_started"
        }
      };
    });
    const patientView = req.user?.role === "patient";
    res.json({
      cases: caseViews,
      referrals: referrals.map((item) => ({
        id: item._id.toString(),
        reference: item.referralCode ?? item._id.toString(),
        caseId: item.case.toString(),
        destination: item.hospital,
        specialty: item.toSpecialty,
        priority: item.priority,
        reason: item.reason,
        status: item.status,
        appointmentDetails: item.appointmentDetails,
        createdAt: item.createdAt
      })),
      appointments: appointments.map((item) => ({
        id: item._id.toString(),
        caseId: item.case?.toString(),
        hospital: item.hospital,
        startAt: item.startAt,
        endAt: item.endAt,
        status: item.status,
        tokenNo: item.tokenNo
      })),
      followUps: followUps.map((item) => safeFollowUp(item, patientView))
    });
  } catch (error) { next(error); }
};

export const caseCareOverview: RequestHandler = async (req, res, next) => {
  try {
    const caseId = idSchema.parse(req.params.id);
    const item = await Case.findById(caseId).select("patient status priorityBand createdAt updatedAt");
    if (!item) return fail(res, "NOT_FOUND", "Case not found.", 404);
    const [review, inference, images, referrals, appointments, followUps] = await Promise.all([
      Review.findOne({ case: item._id }).sort({ version: -1 }).select("decision signedAt createdAt"),
      AiInference.findOne({ case: item._id }).sort({ createdAt: -1 }).populate("model", "name version").select("state model createdAt"),
      CaseImage.find({ case: item._id }).select("qualityStatus"),
      Referral.find({ case: item._id }).sort({ createdAt: -1 }).populate("hospital", "name code").select("case referralCode toSpecialty hospital priority reason status appointment appointmentDetails createdAt"),
      Appointment.find({ case: item._id, patient: item.patient }).sort({ startAt: -1 }).populate("hospital", "name").select("case clinician hospital startAt endAt status tokenNo createdAt"),
      FollowUp.find({ case: item._id }).sort({ scheduledAt: 1 }).limit(100)
    ]);
    const patientView = req.user?.role === "patient";
    res.json({
      cases: [{
        id: item._id.toString(),
        status: item.status,
        priorityBand: item.priorityBand,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        doctorReview: review ? { status: "reviewed", decision: review.decision, reviewedAt: review.signedAt ?? review.createdAt } : { status: "pending" },
        imageQuality: images.map((image) => image.qualityStatus),
        aiResult: inference ? {
          category: null,
          processingStatus: "demo_not_validated",
          clinicallyValidated: false,
          model: inference.model,
          processedAt: inference.createdAt
        } : {
          category: images.length ? "AI_PROCESSING_UNAVAILABLE" : null,
          processingStatus: images.length ? "unavailable" : "not_started"
        }
      }],
      referrals: referrals.map((referral) => ({
        id: referral._id.toString(),
        reference: referral.referralCode ?? referral._id.toString(),
        caseId: referral.case.toString(),
        destination: referral.hospital,
        specialty: referral.toSpecialty,
        priority: referral.priority,
        reason: referral.reason,
        status: referral.status,
        appointmentDetails: referral.appointmentDetails,
        createdAt: referral.createdAt
      })),
      appointments: appointments.map((appointment) => ({
        id: appointment._id.toString(),
        caseId: appointment.case?.toString(),
        hospital: appointment.hospital,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        status: appointment.status,
        tokenNo: appointment.tokenNo
      })),
      followUps: followUps.map((followUp) => safeFollowUp(followUp, patientView))
    });
  } catch (error) { next(error); }
};

export const listPatientFollowUps: RequestHandler = async (req, res, next) => {
  try {
    const patientId = idSchema.parse(req.params.id);
    const followUps = await FollowUp.find({ patient: patientId }).sort({ scheduledAt: 1 }).limit(100);
    res.json({ followUps: followUps.map((item) => safeFollowUp(item, req.user?.role === "patient")) });
  } catch (error) { next(error); }
};

export const assignedFollowUps: RequestHandler = async (req, res, next) => {
  try {
    const followUps = await FollowUp.find({ assignedTo: req.user!.id, status: { $in: ["pending", "scheduled", "missed", "rescheduled"] } })
      .sort({ scheduledAt: 1 }).limit(100);
    const patients = await Patient.find({ _id: { $in: followUps.map((item) => item.patient) } }).select("_id patientCode").lean();
    const patientCodes = new Map(patients.map((patient) => [String(patient._id), patient.patientCode]));
    res.json({ followUps: followUps.map((item) => ({
      ...safeFollowUp(item, false),
      patient: { patientCode: patientCodes.get(item.patient.toString()) }
    })) });
  } catch (error) { next(error); }
};

export const createFollowUp: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      referralId: idSchema.optional(),
      appointmentId: idSchema.optional(),
      scheduledAt: z.coerce.date().refine((value) => value > new Date(), "A future follow-up date is required."),
      notes: z.string().trim().max(5000).optional()
    }).strict().parse(req.body);
    const caseId = idSchema.parse(req.params.id);
    const item = await Case.findById(caseId).select("patient");
    if (!item) return fail(res, "NOT_FOUND", "Case not found.", 404);
    if (body.referralId && !await Referral.exists({ _id: body.referralId, case: caseId })) return fail(res, "REFERRAL_MISMATCH", "The referral does not belong to this case.", 400);
    if (body.appointmentId && !await Appointment.exists({ _id: body.appointmentId, case: caseId, patient: item.patient })) return fail(res, "APPOINTMENT_MISMATCH", "The appointment does not belong to this patient and case.", 400);
    const now = new Date();
    const followUp = await FollowUp.create({
      case: caseId,
      patient: item.patient,
      referral: body.referralId,
      appointment: body.appointmentId,
      assignedTo: req.user!.id,
      scheduledAt: body.scheduledAt,
      status: "scheduled",
      notes: body.notes,
      createdBy: req.user!.id,
      history: [{ status: "scheduled", scheduledAt: body.scheduledAt, changedBy: req.user!.id, changedAt: now }]
    });
    await AuditLog.create({ actor: req.user!.id, action: "follow_up_created", resource: "FollowUp", resourceId: followUp._id.toString(), metadata: { case: caseId, status: followUp.status } });
    await queueWorkflowNotification({ eventKey: `followup:${followUp._id}:scheduled`, patientId: item.patient.toString(), actorId: req.user!.id, template: "follow_up_scheduled" });
    res.status(201).json({ followUp: safeFollowUp(followUp, false) });
  } catch (error) { next(error); }
};

export const updateFollowUp: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      status: z.enum(followUpStatuses),
      scheduledAt: z.coerce.date().optional(),
      notes: z.string().trim().max(5000).optional(),
      note: z.string().trim().max(1000).optional()
    }).strict().parse(req.body);
    const followUp = await FollowUp.findById(idSchema.parse(req.params.id));
    if (!followUp) return fail(res, "NOT_FOUND", "Follow-up not found.", 404);
    if (!isFollowUpTransitionAllowed(followUp.status, body.status)) return fail(res, "INVALID_FOLLOW_UP_TRANSITION", "This follow-up status transition is not allowed.", 409);
    if (["scheduled", "rescheduled"].includes(body.status) && (!body.scheduledAt || body.scheduledAt <= new Date())) return fail(res, "SCHEDULE_REQUIRED", "Provide a future date when scheduling or rescheduling.", 400);
    if (body.scheduledAt && body.scheduledAt <= new Date()) return fail(res, "SCHEDULE_REQUIRED", "The follow-up date must be in the future.", 400);
    const changedAt = new Date();
    const previousScheduledAt = followUp.scheduledAt;
    followUp.status = body.status;
    if (body.scheduledAt) followUp.scheduledAt = body.scheduledAt;
    if (body.notes !== undefined) followUp.notes = body.notes;
    followUp.history.push({
      status: body.status,
      scheduledAt: body.scheduledAt ?? previousScheduledAt,
      changedBy: req.user!.id,
      changedAt,
      note: body.note
    });
    await followUp.save();
    await AuditLog.create({ actor: req.user!.id, action: "follow_up_updated", resource: "FollowUp", resourceId: followUp._id.toString(), metadata: { previousStatus: followUp.history.at(-2)?.status, status: followUp.status } });
    await queueWorkflowNotification({
      eventKey: `followup:${followUp._id}:${followUp.status}:${followUp.updatedAt?.getTime() ?? changedAt.getTime()}`,
      patientId: followUp.patient.toString(),
      actorId: req.user!.id,
      template: body.status === "completed" ? "follow_up_completed" : "follow_up_updated"
    });
    res.json({ followUp: safeFollowUp(followUp, false) });
  } catch (error) { next(error); }
};

export const referralDestinations: RequestHandler = async (req, res, next) => {
  try {
    const profile = await DoctorProfile.findOne({ user: req.user!.id }).select("hospital");
    const hospitals = await Hospital.find({ active: true, ...(profile?.hospital ? { _id: { $ne: profile.hospital } } : {}) })
      .sort({ name: 1 }).select("name code type specialties services").limit(100).lean();
    res.json({ destinations: hospitals });
  } catch (error) { next(error); }
};

export const patientMedicalReport: RequestHandler = async (req, res, next) => {
  try {
    const patientId = idSchema.parse(req.params.id);
    const [patient, cases, appointments, followUps] = await Promise.all([
      Patient.findById(patientId).select("patientCode"),
      Case.find({ patient: patientId }).sort({ createdAt: -1 }).limit(100).select("_id status createdAt"),
      Appointment.find({ patient: patientId }).sort({ startAt: -1 }).limit(100).populate("hospital", "name"),
      FollowUp.find({ patient: patientId }).sort({ scheduledAt: 1 }).limit(100)
    ]);
    if (!patient) return fail(res, "NOT_FOUND", "Patient not found.", 404);
    const caseIds = cases.map((item) => item._id);
    const [reviews, inferences, referrals, investigations] = await Promise.all([
      Review.find({ case: { $in: caseIds } }).sort({ version: -1 }).select("case decision findings reason signedAt createdAt"),
      AiInference.find({ case: { $in: caseIds } }).sort({ createdAt: -1 }).select("case state metadata createdAt"),
      Referral.find({ case: { $in: caseIds } }).sort({ createdAt: -1 }).populate("hospital", "name"),
      Investigation.find({ case: { $in: caseIds } }).select("_id case status type")
    ]);
    const reports = await Report.find({ investigation: { $in: investigations.map((item) => item._id) } }).select("investigation summary reviewedAt createdAt");
    await AuditLog.create({ actor: req.user!.id, action: "report_generated", resource: "PatientCareReport", resourceId: patientId, metadata: { caseCount: cases.length, synthetic: true } });
    const document = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", next);
    document.on("end", () => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", 'attachment; filename="aarogya-drishti-simulation-report.pdf"');
      res.type("application/pdf").send(Buffer.concat(chunks));
    });
    document.fontSize(17).text("Aarogya Drishti — Synthetic Care Summary");
    document.fontSize(10).fillColor("#9a3412").text("SIMULATION ONLY · NOT FOR CLINICAL USE · NOT A DIAGNOSIS");
    document.fillColor("#111827").moveDown().fontSize(11).text(`Patient reference: ${patient.patientCode ?? patientId}`);
    document.text(`Generated: ${new Date().toISOString()}`);
    document.moveDown().fontSize(14).text("Screening history");
    for (const item of cases) {
      const review = reviews.find((entry) => entry.case.toString() === item._id.toString());
      const inference = inferences.find((entry) => entry.case.toString() === item._id.toString());
      document.fontSize(10).text(`${item._id} · ${item.status} · ${item.createdAt.toISOString()}`);
      document.text(`AI observation: ${inference ? "Demonstration-only; no clinically validated observation is available." : "AI_PROCESSING_UNAVAILABLE"}`);
      document.text(`Doctor review: ${review ? `${review.decision} · ${review.signedAt?.toISOString() ?? review.createdAt.toISOString()}` : "Pending"}`);
      if (review?.findings) document.text(`Doctor-entered observations: ${review.findings}`);
      document.moveDown(0.5);
    }
    document.moveDown().fontSize(14).text("Referral history");
    for (const referral of referrals) {
      const hospital = referral.hospital as unknown as { name?: string };
      document.fontSize(10).text(`${referral.referralCode ?? referral._id} · ${referral.status} · ${hospital?.name ?? "Authorized destination"} · ${referral.toSpecialty}`);
      document.text(`Reason: ${referral.reason}`);
    }
    document.moveDown().fontSize(14).text("Appointment history");
    for (const appointment of appointments) {
      const hospital = appointment.hospital as unknown as { name?: string };
      document.fontSize(10).text(`${appointment.startAt.toISOString()} · ${appointment.status} · ${hospital?.name ?? "Designated centre"} · token ${appointment.tokenNo ?? "—"}`);
    }
    document.moveDown().fontSize(14).text("Follow-up history");
    for (const followUp of followUps) document.fontSize(10).text(`${followUp.scheduledAt.toISOString()} · ${followUp.status}`);
    document.moveDown().fontSize(14).text("Uploaded investigation report summaries");
    for (const report of reports) document.fontSize(10).text(`${report.summary}${report.reviewedAt ? " · reviewed" : " · pending review"}`);
    document.moveDown().fontSize(9).fillColor("#9a3412").text("AI screening results are preliminary decision-support information only. They are not a medical diagnosis. A qualified healthcare professional must independently review the case. Any sample data and report content in this environment are synthetic.");
    document.end();
  } catch (error) { next(error); }
};

export const followUpCareRelationship: RequestHandler = async (req, res, next) => {
  try {
    const followUp = await FollowUp.findById(idSchema.parse(req.params.id)).select("case patient");
    if (!followUp) return fail(res, "NOT_FOUND", "Follow-up not found.", 404);
    const patient = await Patient.findById(followUp.patient).select("createdBy mandalId phcId habitationId mandal");
    if (!patient) return fail(res, "NOT_FOUND", "Patient not found.", 404);
    const assigned = patientIsAssigned(patient, req.user!);
    const appointment = req.user!.role === "doctor" && await Appointment.exists({
      clinician: req.user!.id,
      patient: followUp.patient,
      $or: [{ case: followUp.case }, { case: { $exists: false } }],
      status: { $ne: "cancelled" }
    });
    if (!assigned && !appointment) return fail(res, "RELATIONSHIP_REQUIRED", "A care relationship is required.", 403);
    next();
  } catch (error) { next(error); }
};
