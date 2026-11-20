import type { RequestHandler } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { AuditLog } from "../models/AuditLog.js";
import { CampParticipant, HealthCamp } from "../models/HealthCamp.js";
import { Case } from "../models/Case.js";
import { CommunityVisit } from "../models/CommunityVisit.js";
import { Consent } from "../models/Consent.js";
import { FollowUp } from "../models/FollowUp.js";
import { Patient } from "../models/Patient.js";
import { Referral } from "../models/Referral.js";
import { Phc, Village } from "../models/Geo.js";
import { decrypt, encrypt } from "../services/encryption.js";
import { encryptPatientFields, findPossibleDuplicates, normalizePhone, phoneHashVariants, presentPatient } from "../services/patientService.js";
import { patientIsAssigned } from "../middleware/patientCareRelationship.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const failure = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) =>
  res.status(status).json({ error: { code, message_en } });
const inScope = (patient: Parameters<typeof patientIsAssigned>[0], user: NonNullable<Express.Request["user"]>) =>
  user.role === "asha_worker" && patientIsAssigned(patient, user);
const patientFields = "createdBy mandal mandalId phcId villageId habitationId phoneHash";
const ashaPatientFilter = (user: NonNullable<Express.Request["user"]>) => {
  const filters: Array<{ phcId?: string; villageId?: string }> = [];
  for (const assignment of user.assignments ?? []) {
    if (assignment.phc && assignment.village) filters.push({ phcId: assignment.phc, villageId: assignment.village });
    else if (assignment.village) filters.push({ villageId: assignment.village });
    else if (assignment.phc) filters.push({ phcId: assignment.phc });
  }
  return filters;
};

function visitPayload(visit: InstanceType<typeof CommunityVisit>) {
  const { notesEncrypted, ...item } = visit.toObject();
  return { ...item, notes: notesEncrypted ? decrypt(notesEncrypted) : "" };
}

export const ashaDashboard: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user!;
    const patientFilter = ashaPatientFilter(user);
    const assignedPhcIds = [...new Set((user.assignments ?? []).flatMap((assignment) => assignment.phc ? [assignment.phc] : []))];
    const assignedVillageIds = [...new Set((user.assignments ?? []).flatMap((assignment) => assignment.village ? [assignment.village] : []))];
    const [phcs, villages] = await Promise.all([
      Phc.find({ _id: { $in: assignedPhcIds }, active: true }).select("_id name name_en").sort({ name: 1 }).lean(),
      Village.find({ _id: { $in: assignedVillageIds } }).select("_id name name_en phc mandal").sort({ name: 1 }).lean()
    ]);
    if (!patientFilter.length) return res.json({ summary: { patients: 0, dueVisits: 0, visitsLast30Days: 0, pendingReferrals: 0 }, phcs, villages });
    const patients = await Patient.find({ active: true, $or: patientFilter }).select("_id");
    const patientIds = patients.map((patient) => patient._id);
    const caseIds = await Case.find({ patient: { $in: patientIds } }).distinct("_id");
    const [dueVisits, visitsLast30Days, pendingReferrals] = await Promise.all([
      CommunityVisit.countDocuments({ worker: user.id, nextFollowUpAt: { $lte: new Date() } }),
      CommunityVisit.countDocuments({ worker: user.id, visitedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
      Referral.countDocuments({ case: { $in: caseIds }, status: { $nin: ["completed", "cancelled"] } })
    ]);
    res.setHeader("Cache-Control", "no-store").json({ summary: { patients: patients.length, dueVisits, visitsLast30Days, pendingReferrals }, phcs, villages });
  } catch (error) { next(error); }
};

export const grantAshaScreeningConsent: RequestHandler = async (req, res, next) => {
  try {
    const patientId = objectId.parse(String(req.params.patientId));
    const body = z.object({ confirmedByPatient: z.literal(true) }).strict().safeParse(req.body);
    if (!body.success) return failure(res, "CONSENT_REQUIRED", "Record the patient's explicit screening consent.");
    const patient = await Patient.findById(patientId).select(patientFields);
    if (!patient) return failure(res, "NOT_FOUND", "Patient not found.", 404);
    if (!inScope(patient, req.user!)) return failure(res, "OUTSIDE_ASSIGNMENT", "This patient is outside your assigned village and PHC.", 403);
    const consent = await Consent.create({
      patient: patient._id,
      purpose: "screening",
      granted: true,
      grantedBy: req.user!.id,
      consentVersion: "asha-screening-v1"
    });
    await AuditLog.create({ actor: req.user!.id, action: "asha_screening_consent_recorded", resource: "Consent", resourceId: consent._id.toString(), ip: req.ip, metadata: { patientId } });
    res.status(201).json({ consent: { id: consent._id.toString(), purpose: consent.purpose, granted: consent.granted, createdAt: consent.createdAt } });
  } catch (error) { next(error); }
};

export const ashaCampParticipants: RequestHandler = async (req, res, next) => {
  try {
    const campId = objectId.parse(String(req.params.campId));
    const camp = await HealthCamp.findById(campId).select("phc village");
    if (!camp) return failure(res, "NOT_FOUND", "Health camp not found.", 404);
    const allowed = (req.user!.assignments ?? []).some((assignment) =>
      (!assignment.phc || assignment.phc === camp.phc.toString())
      && (!assignment.village || assignment.village === camp.village.toString())
      && Boolean(assignment.phc || assignment.village));
    if (!allowed) return failure(res, "FORBIDDEN", "This camp is outside your assigned village and PHC.", 403);
    const participants = await CampParticipant.find({ camp: camp._id }).select("_id patient status attendedAt").sort({ createdAt: 1 }).lean();
    res.setHeader("Cache-Control", "no-store").json({
      participants: participants.map((participant) => ({
        id: String(participant._id),
        patientId: String(participant.patient),
        status: participant.status,
        attendedAt: participant.attendedAt
      }))
    });
  } catch (error) { next(error); }
};

export const assignedAshaPatients: RequestHandler = async (req, res, next) => {
  try {
    const patientFilter = ashaPatientFilter(req.user!);
    const patients = patientFilter.length
      ? await Patient.find({ active: true, $or: patientFilter }).sort({ updatedAt: -1 }).limit(200)
      : [];
    res.setHeader("Cache-Control", "no-store").json({ patients: patients.map(presentPatient) });
  } catch (error) { next(error); }
};

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(7).max(20),
  ageYears: z.number().int().min(0).max(120),
  address: z.string().trim().max(500).optional(),
  phcId: objectId,
  villageId: objectId,
  preferredLanguage: z.enum(["en", "te", "hi"]).default("en"),
  registrationConsent: z.literal(true),
  screeningConsent: z.boolean().default(false)
}).strict();

export const registerAshaPatient: RequestHandler = async (req, res, next) => {
  try {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return failure(res, "VALIDATION_ERROR", "Check the patient details and confirm registration consent.");
    const body = parsed.data;
    const assignmentMatches = (req.user!.assignments ?? []).some((assignment) =>
      assignment.phc === body.phcId && assignment.village === body.villageId);
    if (!assignmentMatches) return failure(res, "OUTSIDE_ASSIGNMENT", "Patient registration is limited to your assigned village and PHC.", 403);
    const [phc, village] = await Promise.all([
      Phc.findOne({ _id: body.phcId, active: true }).select("_id district mandal name name_en"),
      Village.findById(body.villageId).select("_id district mandal phc name name_en")
    ]);
    if (!phc || !village || village.mandal.toString() !== phc.mandal.toString()
      || village.district.toString() !== phc.district.toString()
      || (village.phc && village.phc.toString() !== phc._id.toString())) {
      return failure(res, "INVALID_LOCATION", "The selected village is not assigned to the selected PHC.");
    }
    const phone = normalizePhone(body.phone);
    if (await Patient.exists({ phoneHash: { $in: phoneHashVariants(phone) } })) {
      return failure(res, "PATIENT_PHONE_EXISTS", "A patient record already uses this mobile number. Do not create a duplicate record.", 409);
    }
    const duplicate = await findPossibleDuplicates(body.name, village.mandal.toString());
    if (duplicate.length) return failure(res, "POSSIBLE_DUPLICATE", "A similar patient record already exists. Ask an authorized clinician to review it.", 409);
    const created = await Patient.create({
      ...encryptPatientFields({
        name: body.name,
        phone,
        address: body.address,
        district: phc.district.toString(),
        mandal: phc.mandal.toString(),
        village: village.name_en ?? village.name,
        ageYears: body.ageYears,
        preferredLanguage: body.preferredLanguage,
        phcId: phc._id,
        villageId: village._id,
        mandalId: phc.mandal
      }),
      active: true,
      registrationStatus: "verified",
      createdBy: req.user!.id
    });
    try {
      await Consent.create({
        patient: created._id,
        purpose: "registration",
        granted: true,
        grantedBy: req.user!.id,
        consentVersion: "asha-registration-v1"
      });
      if (body.screeningConsent) await Consent.create({
        patient: created._id,
        purpose: "screening",
        granted: true,
        grantedBy: req.user!.id,
        consentVersion: "asha-screening-v1"
      });
    } catch (error) {
      await Patient.deleteOne({ _id: created._id });
      throw error;
    }
    await AuditLog.create({
      actor: req.user!.id,
      action: "asha_patient_registered",
      resource: "Patient",
      resourceId: created._id.toString(),
      ip: req.ip,
      metadata: { phcId: body.phcId, villageId: body.villageId, screeningConsent: body.screeningConsent }
    });
    res.status(201).json({ patient: presentPatient(created) });
  } catch (error) { next(error); }
};

const visitSchema = z.object({
  visitedAt: z.coerce.date().default(() => new Date()),
  outcome: z.enum(["contacted", "not_available", "follow_up_needed", "referred"]),
  nextFollowUpAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional()
}).strict();

export const recordAshaVisit: RequestHandler = async (req, res, next) => {
  try {
    const patientId = objectId.parse(String(req.params.patientId));
    const body = visitSchema.safeParse(req.body);
    if (!body.success) return failure(res, "VALIDATION_ERROR", "Provide a valid visit outcome and date.");
    const patient = await Patient.findById(patientId).select(patientFields);
    if (!patient) return failure(res, "NOT_FOUND", "Patient not found.", 404);
    if (!inScope(patient, req.user!)) return failure(res, "OUTSIDE_ASSIGNMENT", "This patient is outside your assigned village and PHC.", 403);
    if (body.data.nextFollowUpAt && body.data.nextFollowUpAt < body.data.visitedAt) return failure(res, "INVALID_FOLLOW_UP_DATE", "A follow-up date cannot be earlier than the visit.");
    const visit = await CommunityVisit.create({
      patient: patient._id,
      worker: req.user!.id,
      visitedAt: body.data.visitedAt,
      outcome: body.data.outcome,
      nextFollowUpAt: body.data.nextFollowUpAt,
      notesEncrypted: body.data.notes ? encrypt(body.data.notes) : undefined
    });
    await AuditLog.create({ actor: req.user!.id, action: "asha_patient_visit_recorded", resource: "CommunityVisit", resourceId: visit._id.toString(), ip: req.ip, metadata: { patientId, outcome: visit.outcome } });
    res.status(201).json({ visit: visitPayload(visit) });
  } catch (error) { next(error); }
};

export const ashaPatientHistory: RequestHandler = async (req, res, next) => {
  try {
    const patientId = objectId.parse(String(req.params.patientId));
    const patient = await Patient.findById(patientId).select(patientFields);
    if (!patient) return failure(res, "NOT_FOUND", "Patient not found.", 404);
    if (!inScope(patient, req.user!)) return failure(res, "OUTSIDE_ASSIGNMENT", "This patient is outside your assigned village and PHC.", 403);
    const [visits, cases] = await Promise.all([
      CommunityVisit.find({ patient: patient._id, worker: req.user!.id }).sort({ visitedAt: -1 }).limit(100),
      Case.find({ patient: patient._id }).select("_id status createdAt").sort({ createdAt: -1 }).limit(100).lean()
    ]);
    const caseIds = cases.map((item) => item._id);
    const [followUps, referrals, camps] = await Promise.all([
      FollowUp.find({ patient: patient._id }).select("scheduledAt status createdAt").sort({ scheduledAt: -1 }).limit(100).lean(),
      Referral.find({ case: { $in: caseIds } }).select("case status priority toSpecialty createdAt").sort({ createdAt: -1 }).limit(100).lean(),
      CampParticipant.find({ patient: patient._id }).select("camp status createdAt").populate("camp", "title startsAt status").sort({ createdAt: -1 }).limit(100).lean()
    ]);
    res.setHeader("Cache-Control", "no-store").json({
      patient: presentPatient(patient),
      visits: visits.map(visitPayload),
      screenings: cases.map((item) => ({ id: String(item._id), status: item.status, createdAt: item.createdAt })),
      followUps: followUps.map((item) => ({ scheduledAt: item.scheduledAt, status: item.status, createdAt: item.createdAt })),
      referrals: referrals.map((item) => ({ status: item.status, priority: item.priority, specialty: item.toSpecialty, createdAt: item.createdAt })),
      camps: camps.map((item) => ({ status: item.status, camp: item.camp, createdAt: item.createdAt }))
    });
  } catch (error) { next(error); }
};

export const ashaActivityReport: RequestHandler = async (req, res, next) => {
  try {
    const query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional()
    }).strict().refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to)).parse(req.query);
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) return failure(res, "DATE_RANGE_TOO_LARGE", "Activity reports are limited to one year.");
    const [totalVisits, byOutcome, upcomingFollowUps] = await Promise.all([
      CommunityVisit.countDocuments({ worker: req.user!.id, visitedAt: { $gte: from, $lte: to } }),
      CommunityVisit.aggregate([
        { $match: { worker: new Types.ObjectId(req.user!.id), visitedAt: { $gte: from, $lte: to } } },
        { $group: { _id: "$outcome", count: { $sum: 1 } } },
        { $project: { _id: 0, outcome: "$_id", count: 1 } }
      ]),
      CommunityVisit.countDocuments({ worker: req.user!.id, nextFollowUpAt: { $gte: new Date(), $lte: to } })
    ]);
    res.json({ period: { from, to }, totalVisits, byOutcome, upcomingFollowUps });
  } catch (error) { next(error); }
};
