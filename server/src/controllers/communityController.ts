import { Types } from "mongoose";
import PDFDocument from "pdfkit";
import type { RequestHandler } from "express";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { Case } from "../models/Case.js";
import { CampParticipant, HealthCamp } from "../models/HealthCamp.js";
import { EmergencyRequest } from "../models/EmergencyRequest.js";
import { Consent } from "../models/Consent.js";
import { LocationShare } from "../models/LocationShare.js";
import { Appointment } from "../models/Appointment.js";
import { CaseImage } from "../models/CaseImage.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Notification } from "../models/Notification.js";
import { Hospital, Mandal, Phc, Village } from "../models/Geo.js";
import { Patient } from "../models/Patient.js";
import { Referral } from "../models/Referral.js";
import { User } from "../models/User.js";
import { patientIsAssigned, patientIsWithinDistrict } from "../middleware/patientCareRelationship.js";
import { permittedDashboardMandals } from "../services/dashboardService.js";
import { phoneHashVariants } from "../services/patientService.js";
import { decrypt, encrypt } from "../services/encryption.js";
import { facilityAvailability } from "../services/facilityAvailability.js";
import { queuePatientNotification } from "../services/workflowNotificationService.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const failure = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) =>
  res.status(status).json({ error: { code, message_en } });
const activeConsent = (patient: string, purpose: string) => Consent.exists({
  patient,
  purpose,
  granted: true,
  $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
});
const idOf = (value: unknown) => value && typeof value === "object" && "_id" in value
  ? String((value as { _id: unknown })._id)
  : String(value ?? "");
const asOne = <T>(value: T | T[] | null | undefined): T | undefined =>
  (Array.isArray(value) ? value[0] : value) ?? undefined;
type PatientAccessFields = Parameters<typeof patientIsAssigned>[0];
type PatientForEmergency = PatientAccessFields & { _id: Types.ObjectId; patientCode?: string };

async function findOwnEmergencyPatient(phone?: string) {
  const patients = phone
    ? await Patient.find({ phoneHash: { $in: phoneHashVariants(phone) }, active: true })
      .select("_id patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId")
      .limit(2)
    : [];
  return {
    patient: patients.length === 1 ? patients[0] : null,
    ambiguous: patients.length > 1
  };
}

async function permittedMandals(user: NonNullable<Express.Request["user"]>) {
  if (user.role === "system_admin") return null;
  if (user.role === "district_admin") return permittedDashboardMandals(user);
  if (user.role === "hospital_manager" && user.hospitalId) {
    const hospital = asOne(await Hospital.findById(user.hospitalId).select("mandalId").lean());
    return hospital?.mandalId ? [String(hospital.mandalId)] : [];
  }
  if (user.role === "doctor") {
    const assigned = (user.assignments ?? []).flatMap((item) => item.mandal ? [item.mandal] : []);
    const ids = assigned.filter((value) => /^[a-f\d]{24}$/i.test(value));
    const labels = assigned.filter((value) => !/^[a-f\d]{24}$/i.test(value));
    const rows = await Mandal.find({ $or: [
      ...(ids.length ? [{ _id: { $in: ids } }] : []),
      ...(labels.length ? [{ code: { $in: labels } }, { name: { $in: labels } }, { name_en: { $in: labels } }] : [])
    ] }).distinct("_id");
    const profile = asOne(await DoctorProfile.findOne({ user: user.id }).select("hospital").lean());
    if (profile?.hospital) {
      const hospital = asOne(await Hospital.findById(profile.hospital).select("mandalId").lean());
      if (hospital?.mandalId) rows.push(hospital.mandalId);
    }
    return [...new Set(rows.map(String))];
  }
  if (user.role === "asha_worker") {
    const assigned = (user.assignments ?? []).flatMap((item) => item.mandal ? [item.mandal] : []);
    const ids = assigned.filter((value) => /^[a-f\d]{24}$/i.test(value));
    const labels = assigned.filter((value) => !/^[a-f\d]{24}$/i.test(value));
    const rows = await Mandal.find({ $or: [
      ...(ids.length ? [{ _id: { $in: ids } }] : []),
      ...(labels.length ? [{ code: { $in: labels } }, { name: { $in: labels } }, { name_en: { $in: labels } }] : [])
    ] }).distinct("_id");
    return [...new Set(rows.map(String))];
  }
  return [];
}

async function canAccessCamp(camp: {
  mandal: unknown;
  phc?: unknown;
  village?: unknown;
  hospital?: unknown;
  assignedDoctors?: unknown[];
}, user: NonNullable<Express.Request["user"]>) {
  if (user.role === "system_admin") return true;
  if (user.role === "hospital_manager") return Boolean(user.hospitalId && idOf(camp.hospital) === user.hospitalId);
  if (user.role === "district_admin") {
    const mandals = await permittedMandals(user);
    return Boolean(mandals?.includes(idOf(camp.mandal)));
  }
  if (user.role === "doctor") {
    if ((camp.assignedDoctors ?? []).some((id) => idOf(id) === user.id)) return true;
    const mandals = await permittedMandals(user);
    return Boolean(mandals?.includes(idOf(camp.mandal)));
  }
  if (user.role === "asha_worker") {
    return (user.assignments ?? []).some((assignment) =>
      (!assignment.phc || assignment.phc === idOf(camp.phc))
      && (!assignment.village || assignment.village === idOf(camp.village))
      && Boolean(assignment.phc || assignment.village));
  }
  return false;
}

async function getLocationOptions(user: NonNullable<Express.Request["user"]>) {
  const mandals = await permittedMandals(user);
  const mandalFilter = mandals === null ? {} : { _id: { $in: mandals } };
  const [mandalRows, phcRows, villageRows, hospitals] = await Promise.all([
    Mandal.find(mandalFilter).select("_id name name_en name_te name_hi code district").sort({ name: 1 }).limit(500).lean(),
    Phc.find({ ...mandalFilter, active: true }).select("_id name name_en code mandal district").sort({ name: 1 }).limit(500).lean(),
    Village.find(mandalFilter).select("_id name name_en name_te name_hi code mandal phc").sort({ name: 1 }).limit(1000).lean(),
    Hospital.find({ active: true, ...(user.role === "hospital_manager" ? { _id: user.hospitalId } : mandals === null ? {} : { mandalId: { $in: mandals } }) })
      .select("_id name code type mandalId services").sort({ name: 1 }).limit(500).lean()
  ]);
  const verifiedDoctors = await DoctorProfile.find({
    ...(mandals === null ? {} : { hospital: { $in: hospitals.map((hospital) => hospital._id) } }),
    $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }]
  }).select("user hospital").populate({ path: "user", match: { role: "doctor", status: "active" }, select: "_id name" }).limit(500).lean();
  return {
    mandals: mandalRows,
    phcs: phcRows,
    villages: villageRows,
    hospitals,
    doctors: verifiedDoctors.flatMap((profile) => profile.user
      ? [{ id: idOf(profile.user), name: (profile.user as { name?: string }).name ?? "Doctor", hospitalId: idOf(profile.hospital) }]
      : [])
  };
}

export const communityOptions: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store").json(await getLocationOptions(req.user!));
  } catch (error) { next(error); }
};

const campCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  mandalId: objectId,
  phcId: objectId,
  villageId: objectId,
  hospitalId: objectId.optional(),
  assignedDoctorIds: z.array(objectId).max(10).default([]),
  notes: z.string().trim().max(2000).optional()
}).strict();

export const listCamps: RequestHandler = async (req, res, next) => {
  try {
    const mandals = await permittedMandals(req.user!);
    const filter: Record<string, unknown> = mandals === null ? {} : { mandal: { $in: mandals } };
    if (req.user!.role === "hospital_manager") filter.hospital = req.user!.hospitalId;
    if (req.user!.role === "doctor") {
      filter.$or = [
        ...(mandals?.length ? [{ mandal: { $in: mandals } }] : []),
        { assignedDoctors: req.user!.id }
      ];
    }
    if (req.user!.role === "asha_worker") {
      const assignedCamps: Array<{ phc?: string; village?: string }> = [];
      for (const assignment of req.user!.assignments ?? []) {
        if (assignment.phc && assignment.village) assignedCamps.push({ phc: assignment.phc, village: assignment.village });
        else if (assignment.village) assignedCamps.push({ village: assignment.village });
        else if (assignment.phc) assignedCamps.push({ phc: assignment.phc });
      }
      filter.$or = assignedCamps;
    }
    const camps = await HealthCamp.find(filter).sort({ startsAt: -1 }).limit(100)
      .populate("mandal", "name name_en name_te name_hi")
      .populate("phc", "name name_en")
      .populate("village", "name name_en name_te name_hi")
      .populate("hospital", "name code")
      .populate("assignedDoctors", "name")
      .lean();
    const rows = await Promise.all(camps.map(async (camp) => {
      const counts = await CampParticipant.aggregate([
        { $match: { camp: camp._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]);
      const count = (status: string) => counts.find((item) => item._id === status)?.count ?? 0;
      return {
        ...camp,
        totals: {
          registered: suppressed(count("registered") + count("attended") + count("no_show")),
          attended: suppressed(count("attended")),
          noShow: suppressed(count("no_show"))
        }
      };
    }));
    res.setHeader("Cache-Control", "no-store").json({ camps: rows });
  } catch (error) { next(error); }
};

async function findOwnCampPatient(req: Parameters<RequestHandler>[0]) {
  const phone = req.user?.phone;
  if (req.user?.role !== "patient" || !phone) return { error: "FORBIDDEN" as const };
  const patients = await Patient.find({ phoneHash: { $in: phoneHashVariants(phone) }, active: true }).limit(2);
  if (patients.length !== 1) return { error: patients.length ? "PATIENT_LINK_AMBIGUOUS" as const : "NOT_FOUND" as const };
  return { patient: patients[0] };
}

async function ownCampScope(patient: InstanceType<typeof Patient>) {
  if (patient.villageId) return { village: patient.villageId };
  if (patient.phcId) return { phc: patient.phcId };
  if (patient.mandalId) return { mandal: patient.mandalId };
  if (patient.mandal) {
    const mandal = await Mandal.findOne({
      $or: [
        { name: patient.mandal },
        { name_en: patient.mandal },
        { name_te: patient.mandal },
        { name_hi: patient.mandal },
        { code: patient.mandal }
      ]
    }).select("_id");
    if (mandal) return { mandal: mandal._id };
  }
  return null;
}

export const listOwnHealthCamps: RequestHandler = async (req, res, next) => {
  try {
    const result = await findOwnCampPatient(req);
    if (!result.patient) return failure(res, result.error ?? "PATIENT_ACCESS_UNAVAILABLE", "Unable to resolve the patient record linked to this account.", result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409);
    const scope = await ownCampScope(result.patient);
    if (!scope) return res.setHeader("Cache-Control", "no-store").json({ camps: [] });
    const camps = await HealthCamp.find({
      ...scope,
      status: { $in: ["planned", "open"] },
      endsAt: { $gte: new Date() }
    }).select("-notes").sort({ startsAt: 1 }).limit(50)
      .populate("mandal", "name name_en name_te name_hi")
      .populate("phc", "name name_en")
      .populate("village", "name name_en name_te name_hi")
      .populate("hospital", "name code")
      .populate("assignedDoctors", "name")
      .lean();
    const participants = camps.length
      ? await CampParticipant.find({ patient: result.patient._id, camp: { $in: camps.map((camp) => camp._id) } }).select("camp status").lean()
      : [];
    const statusByCamp = new Map(participants.map((participant) => [participant.camp.toString(), participant.status]));
    res.setHeader("Cache-Control", "no-store").json({
      camps: camps.map((camp) => ({ ...camp, participantStatus: statusByCamp.get(String(camp._id)) ?? null }))
    });
  } catch (error) { next(error); }
};

export const registerOwnHealthCamp: RequestHandler = async (req, res, next) => {
  try {
    const campId = objectId.parse(String(req.params.campId));
    const result = await findOwnCampPatient(req);
    if (!result.patient) return failure(res, result.error ?? "PATIENT_ACCESS_UNAVAILABLE", "Unable to resolve the patient record linked to this account.", result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409);
    const scope = await ownCampScope(result.patient);
    const camp = scope ? await HealthCamp.findOne({ _id: campId, ...scope }) : null;
    if (!camp) return failure(res, "NOT_FOUND", "No health camp is available in your assigned area.", 404);
    if (!["planned", "open"].includes(camp.status) || camp.endsAt < new Date()) {
      return failure(res, "CAMP_CLOSED", "This camp is no longer accepting registrations.", 409);
    }
    const existing = await CampParticipant.findOne({ camp: camp._id, patient: result.patient._id });
    if (existing) return res.json({ participant: { id: existing._id.toString(), status: existing.status } });
    const participant = await CampParticipant.create({
      camp: camp._id,
      patient: result.patient._id,
      registeredBy: req.user!.id,
      status: "registered"
    });
    await AuditLog.create({
      actor: req.user!.id,
      action: "patient_health_camp_registered",
      resource: "CampParticipant",
      resourceId: participant._id.toString(),
      ip: req.ip,
      metadata: { camp: camp._id.toString() }
    });
    res.status(201).json({ participant: { id: participant._id.toString(), status: participant.status } });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      try {
        const result = await findOwnCampPatient(req);
        if (result.patient) {
          const scope = await ownCampScope(result.patient);
          const camp = scope ? await HealthCamp.findOne({ _id: String(req.params.campId), ...scope }).select("_id") : null;
          const existing = camp ? await CampParticipant.findOne({ camp: camp._id, patient: result.patient._id }) : null;
          if (existing) return res.json({ participant: { id: existing._id.toString(), status: existing.status } });
        }
      } catch (lookupError) {
        return next(lookupError);
      }
      return failure(res, "DUPLICATE_PARTICIPANT", "You are already registered for this camp.", 409);
    }
    next(error);
  }
};

export const createCamp: RequestHandler = async (req, res, next) => {
  try {
    const body = campCreateSchema.parse(req.body);
    if (body.startsAt <= new Date() || body.endsAt <= body.startsAt || body.endsAt.getTime() - body.startsAt.getTime() > 3 * 24 * 60 * 60 * 1000) {
      return failure(res, "INVALID_CAMP_DATES", "Choose a future camp date with an end time no more than three days after it.");
    }
    const [mandal, phc, village] = await Promise.all([
      Mandal.findById(body.mandalId).select("_id district name name_en name_te code"),
      Phc.findById(body.phcId).select("_id district mandal active"),
      Village.findById(body.villageId).select("_id district mandal phc")
    ]);
    if (!mandal || !phc || !phc.active || !village
      || idOf(phc.mandal) !== body.mandalId
      || idOf(village.mandal) !== body.mandalId
      || idOf(phc.district) !== idOf(mandal.district)
      || idOf(village.district) !== idOf(mandal.district)
      || (village.phc && idOf(village.phc) !== body.phcId)) {
      return failure(res, "INVALID_CAMP_LOCATION", "The selected mandal, PHC and village do not match an active service area.");
    }
    const hospitalId = req.user!.role === "hospital_manager" ? req.user!.hospitalId : body.hospitalId;
    if (req.user!.role === "hospital_manager" && body.hospitalId && body.hospitalId !== req.user!.hospitalId) {
      return failure(res, "HOSPITAL_SCOPE_MISMATCH", "Hospital managers can only schedule camps for their assigned hospital.", 403);
    }
    const hospital = hospitalId ? await Hospital.findOne({ _id: hospitalId, active: true }).select("_id mandalId mandal district") : null;
    const hospitalMandalMatches = Boolean(hospital && (
      (hospital.mandalId && idOf(hospital.mandalId) === body.mandalId)
      || (hospital.mandal && idOf(hospital.mandal) === body.mandalId)
      || [mandal?.name, mandal?.name_en, mandal?.name_te, mandal?.code].some((value) =>
        Boolean(value && typeof hospital.mandal === "string" && value.toLocaleLowerCase() === hospital.mandal.toLocaleLowerCase()))
    ));
    if (hospitalId && (!hospital || !hospitalMandalMatches)) {
      return failure(res, "INVALID_CAMP_HOSPITAL", "Select an active hospital in the camp's mandal.");
    }
    if (req.user!.role === "doctor") {
      const allowedMandals = await permittedMandals(req.user!);
      if (!allowedMandals?.includes(body.mandalId)) {
        return failure(res, "OUTSIDE_ASSIGNMENT", "The camp location is outside your authorized service area.", 403);
      }
    }
    const assignedDoctorIds = [...new Set([
      ...(req.user!.role === "doctor" ? [req.user!.id] : []),
      ...body.assignedDoctorIds
    ])];
    if (assignedDoctorIds.length) {
      const verifiedProfiles = await DoctorProfile.find({
        user: { $in: assignedDoctorIds },
        ...(hospitalId ? { hospital: hospitalId } : {}),
        $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }]
      }).select("user hospital").lean();
      const activeDoctors = await User.find({ _id: { $in: assignedDoctorIds }, role: "doctor", status: "active" }).select("_id assignments").lean();
      const doctorById = new Map(activeDoctors.map((doctor) => [idOf(doctor._id), doctor]));
      const validIds = new Set<string>();
      for (const profile of verifiedProfiles) {
        const doctorId = idOf(profile.user);
        const doctor = doctorById.get(doctorId);
        if (!doctor) continue;
        const assignments = doctor.assignments as Array<{ mandal?: string }>;
        const assignmentMatches = assignments.some((assignment) =>
          Boolean(assignment.mandal && [body.mandalId, mandal?.name, mandal?.name_en, mandal?.name_te, mandal?.code]
            .some((value) => value && assignment.mandal!.toLocaleLowerCase() === value.toLocaleLowerCase())));
        const hospitalForDoctor = profile.hospital
          ? asOne(await Hospital.findById(profile.hospital).select("mandalId mandal").lean())
          : undefined;
        const hospitalMatches = Boolean(hospitalForDoctor && (
          idOf(hospitalForDoctor.mandalId) === body.mandalId
          || idOf(hospitalForDoctor.mandal) === body.mandalId
          || [mandal?.name, mandal?.name_en, mandal?.name_te, mandal?.code].some((value) =>
            Boolean(value && typeof hospitalForDoctor.mandal === "string" && value.toLocaleLowerCase() === hospitalForDoctor.mandal.toLocaleLowerCase()))
        ));
        if (hospitalId ? idOf(profile.hospital) === hospitalId : assignmentMatches || hospitalMatches) validIds.add(doctorId);
      }
      if (assignedDoctorIds.some((id) => !validIds.has(id))) {
        return failure(res, "INVALID_CAMP_DOCTOR", "Every assigned doctor must have an active, verified professional profile.", 400);
      }
    }
    if (req.user!.role === "doctor" && !assignedDoctorIds.includes(req.user!.id)) {
      return failure(res, "DOCTOR_ASSIGNMENT_REQUIRED", "Doctors may only create camps to which they are assigned.", 403);
    }
    const proposedCamp = { mandal: mandal._id, hospital: hospital?._id, assignedDoctors: assignedDoctorIds };
    if (!await canAccessCamp(proposedCamp, req.user!)) {
      return failure(res, "OUTSIDE_ASSIGNMENT", "The camp location is outside your authorized service area.", 403);
    }
    const camp = await HealthCamp.create({
      title: body.title,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      mandal: mandal._id,
      phc: phc._id,
      village: village._id,
      hospital: hospital?._id,
      assignedDoctors: assignedDoctorIds,
      createdBy: req.user!.id,
      notes: body.notes
    });
    await AuditLog.create({
      actor: req.user!.id,
      action: "community_camp_created",
      resource: "HealthCamp",
      resourceId: camp._id.toString(),
      ip: req.ip,
      metadata: { mandal: body.mandalId, phc: body.phcId, village: body.villageId }
    });
    res.status(201).json({ camp });
  } catch (error) { next(error); }
};

export const updateCampStatus: RequestHandler = async (req, res, next) => {
  try {
    const camp = await HealthCamp.findById(String(req.params.campId));
    if (!camp) return failure(res, "NOT_FOUND", "Health camp not found.", 404);
    if (!await canAccessCamp(camp, req.user!)) return failure(res, "FORBIDDEN", "You cannot manage this camp.", 403);
    const body = z.object({ status: z.enum(["open", "completed", "cancelled"]) }).strict().parse(req.body);
    const allowed = camp.status === "planned" ? ["open", "cancelled"] : camp.status === "open" ? ["completed", "cancelled"] : [];
    if (!allowed.includes(body.status)) return failure(res, "INVALID_CAMP_TRANSITION", "This camp status change is not allowed.", 409);
    camp.status = body.status;
    await camp.save();
    await AuditLog.create({ actor: req.user!.id, action: "community_camp_status_updated", resource: "HealthCamp", resourceId: camp._id.toString(), ip: req.ip, metadata: { status: camp.status } });
    res.json({ camp });
  } catch (error) { next(error); }
};

const participantSchema = z.object({ patientId: objectId, caseId: objectId.optional() }).strict();
export const registerCampParticipant: RequestHandler = async (req, res, next) => {
  try {
    const body = participantSchema.parse(req.body);
    const camp = await HealthCamp.findById(String(req.params.campId));
    if (!camp) return failure(res, "NOT_FOUND", "Health camp not found.", 404);
    if (!await canAccessCamp(camp, req.user!)) return failure(res, "FORBIDDEN", "You cannot register participants for this camp.", 403);
    if (!["planned", "open"].includes(camp.status)) return failure(res, "CAMP_CLOSED", "This camp is not accepting participants.", 409);
    const patient = await Patient.findOne({ _id: body.patientId, active: true }).select("_id mandal mandalId villageId");
    if (!patient) return failure(res, "PATIENT_NOT_FOUND", "Active patient record not found.", 404);
    const mandal = await Mandal.findById(camp.mandal).select("name name_en name_te code");
    const patientMandalMatches = patient.mandalId
      ? idOf(patient.mandalId) === idOf(camp.mandal)
      : Boolean(mandal && [mandal.name, mandal.name_en, mandal.name_te, mandal.code, idOf(camp.mandal)].some((value) => value?.toLocaleLowerCase() === patient.mandal?.toLocaleLowerCase()));
    if (!patientMandalMatches || (patient.villageId && idOf(patient.villageId) !== idOf(camp.village))) {
      return failure(res, "PATIENT_OUTSIDE_CAMP", "The patient record is outside this camp's village.");
    }
    if (!await activeConsent(body.patientId, "screening")) return failure(res, "CONSENT_REQUIRED", "Active screening consent is required before camp participation.", 403);
    if (body.caseId && !await Case.exists({ _id: body.caseId, patient: body.patientId })) {
      return failure(res, "CASE_MISMATCH", "The screening case does not belong to this patient.");
    }
    const participant = await CampParticipant.findOneAndUpdate(
      { camp: camp._id, patient: patient._id },
      { $setOnInsert: { case: body.caseId, registeredBy: req.user!.id, status: "registered" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await AuditLog.create({ actor: req.user!.id, action: "community_camp_participant_registered", resource: "CampParticipant", resourceId: participant._id.toString(), ip: req.ip, metadata: { camp: camp._id.toString() } });
    res.status(201).json({ participant: { id: participant._id.toString(), status: participant.status } });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return failure(res, "DUPLICATE_PARTICIPANT", "This patient is already registered for the camp.", 409);
    next(error);
  }
};

export const recordCampAttendance: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["attended", "no_show"]), caseId: objectId.optional() }).strict().parse(req.body);
    const participant = await CampParticipant.findById(String(req.params.participantId));
    if (!participant) return failure(res, "NOT_FOUND", "Camp participant not found.", 404);
    const camp = await HealthCamp.findById(participant.camp);
    if (!camp) return failure(res, "NOT_FOUND", "Health camp not found.", 404);
    if (!await canAccessCamp(camp, req.user!)) return failure(res, "FORBIDDEN", "You cannot record attendance for this camp.", 403);
    if (camp.status !== "open") return failure(res, "CAMP_NOT_OPEN", "Attendance can only be recorded while the camp is open.", 409);
    if (!await activeConsent(participant.patient.toString(), "screening")) return failure(res, "CONSENT_REQUIRED", "Active screening consent is required.", 403);
    const caseId = body.caseId ?? participant.case?.toString();
    if (caseId && !await Case.exists({ _id: caseId, patient: participant.patient })) return failure(res, "CASE_MISMATCH", "The screening case does not belong to this patient.");
    if (participant.status !== "registered" && participant.status !== body.status) {
      return failure(res, "ATTENDANCE_ALREADY_RECORDED", "Attendance has already been recorded with a different status.", 409);
    }
    if (participant.status === body.status) {
      return res.json({ participant: { id: participant._id.toString(), status: participant.status, attendedAt: participant.attendedAt } });
    }
    participant.status = body.status;
    participant.case = caseId ? participant.case ?? new Types.ObjectId(caseId) : undefined;
    participant.attendedAt = body.status === "attended" ? new Date() : undefined;
    await participant.save();
    await AuditLog.create({ actor: req.user!.id, action: "community_camp_attendance_recorded", resource: "CampParticipant", resourceId: participant._id.toString(), ip: req.ip, metadata: { camp: camp._id.toString(), status: participant.status, caseLinked: Boolean(caseId) } });
    res.json({ participant: { id: participant._id.toString(), status: participant.status, attendedAt: participant.attendedAt } });
  } catch (error) { next(error); }
};

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  const formulaSafe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}
const suppressed = (count: number) => count === 0 ? 0 : count < 5 ? "<5" : count;
export const campReport: RequestHandler = async (req, res, next) => {
  try {
    const query = z.object({ format: z.enum(["csv", "pdf"]).default("csv") }).strict().parse(req.query);
    const camp = await HealthCamp.findById(String(req.params.campId)).populate("mandal", "name name_en").populate("phc", "name name_en").populate("village", "name name_en");
    if (!camp) return failure(res, "NOT_FOUND", "Health camp not found.", 404);
    if (!await canAccessCamp(camp, req.user!)) return failure(res, "FORBIDDEN", "You cannot export this camp report.", 403);
    const participants = await CampParticipant.find({ camp: camp._id }).select("case status").lean();
    const [registered, attended, noShow, referrals, appointments, imageCount] = await Promise.all([
      Promise.resolve(participants.length),
      Promise.resolve(participants.filter((item) => item.status === "attended").length),
      Promise.resolve(participants.filter((item) => item.status === "no_show").length),
      Referral.countDocuments({ case: { $in: participants.flatMap((item) => item.case ? [item.case] : []) } }),
      Appointment.countDocuments({ case: { $in: participants.flatMap((item) => item.case ? [item.case] : []) } }),
      CaseImage.countDocuments({ case: { $in: participants.flatMap((item) => item.case ? [item.case] : []) } })
    ]);
    const values: Array<[string, unknown]> = [
      ["camp", camp.title],
      ["status", camp.status],
      ["startsAt", camp.startsAt.toISOString()],
      ["endsAt", camp.endsAt.toISOString()],
      ["mandal", (camp.mandal as unknown as { name_en?: string; name?: string }).name_en ?? (camp.mandal as unknown as { name?: string }).name],
      ["phc", (camp.phc as unknown as { name_en?: string; name?: string }).name_en ?? (camp.phc as unknown as { name?: string }).name],
      ["village", (camp.village as unknown as { name_en?: string; name?: string }).name_en ?? (camp.village as unknown as { name?: string }).name],
      ["registeredParticipants", suppressed(registered)],
      ["attendedParticipants", suppressed(attended)],
      ["noShows", suppressed(noShow)],
      ["linkedReferrals", suppressed(referrals)],
      ["linkedAppointments", suppressed(appointments)],
      ["linkedScreeningImages", suppressed(imageCount)]
    ];
    await AuditLog.create({ actor: req.user!.id, action: "community_camp_report_exported", resource: "HealthCamp", resourceId: camp._id.toString(), ip: req.ip, metadata: { aggregateOnly: true, format: query.format } });
    if (query.format === "pdf") {
      const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Health camp aggregate report", Author: "Aarogya Drishti" } });
      const chunks: Buffer[] = [];
      document.on("data", (chunk: Buffer) => chunks.push(chunk));
      document.on("end", () => {
        res.type("application/pdf").setHeader("Content-Disposition", `attachment; filename="health-camp-${camp._id}.pdf"`);
        res.send(Buffer.concat(chunks));
      });
      document.on("error", next);
      document.fontSize(18).text(camp.title);
      document.moveDown(0.5).fontSize(9).fillColor("#475569").text("Synthetic community program data · Not for clinical use · Aggregate counts only");
      document.moveDown().fillColor("#0f172a").fontSize(10);
      for (const [label, value] of values) document.text(`${label}: ${value ?? "—"}`);
      document.end();
    } else {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="health-camp-${camp._id}.csv"`);
      res.send([["metric", "value"], ...values].map((row) => row.map(csvCell).join(",")).join("\r\n"));
    }
  } catch (error) { next(error); }
};

async function canAccessEmergencyPatient(patient: PatientAccessFields, user: NonNullable<Express.Request["user"]>) {
  if (user.role === "system_admin") return true;
  if (user.role === "patient") return Boolean(user.phone && patient.phoneHash && phoneHashVariants(user.phone).includes(patient.phoneHash));
  if (user.role === "doctor") return patientIsAssigned(patient, user);
  if (user.role === "district_admin") return patientIsWithinDistrict(patient, user);
  if (user.role === "asha_worker") return patientIsAssigned(patient, user);
  if (user.role === "hospital_manager" && user.hospitalId) {
    const hospital = asOne(await Hospital.findById(user.hospitalId).select("mandalId").lean());
    return Boolean(hospital?.mandalId && idOf(hospital.mandalId) === idOf(patient.mandalId));
  }
  return false;
}

async function notifyEmergencyStaff(patient: PatientForEmergency, requestId: string, roles: string[], stage = "received") {
  const staff = await User.find({ role: { $in: roles }, status: "active" })
    .select("_id role assignments hospitalId language locale").limit(1000).lean();
  const recipients = await Promise.all(staff.map(async (user) => {
    const userId = String(user._id);
    const access = {
      id: userId,
      role: user.role,
      hospitalId: user.hospitalId?.toString(),
      assignments: user.assignments as Array<{ scope?: string; district?: string; mandal?: string; village?: string; habitation?: string; phc?: string; hospital?: string }> | undefined
    };
    return await canAccessEmergencyPatient(patient, access) ? user : null;
  }));
  const notifications = recipients.filter((user): user is NonNullable<typeof user> => user !== null).map((user) => {
    const userId = String(user._id);
    return {
      updateOne: {
        filter: { dedupeKey: `emergency:${requestId}:${stage}:${userId}` },
        update: { $setOnInsert: {
          user: user._id,
          patient: patient._id,
          channel: "inapp",
          template: stage === "received" ? "emergency_request_received" : "emergency_request_escalated",
          language: user.language ?? user.locale ?? "en",
          variables: { requestId },
          dedupeKey: `emergency:${requestId}:${stage}:${userId}`
        } },
        upsert: true
      }
    };
  });
  if (notifications.length) await Notification.bulkWrite(notifications, { ordered: false });
}

export async function notifyEmergencyStaffForPatient(patientId: string, requestId: string, roles: string[]) {
  const patient = await Patient.findById(patientId).select("_id patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId");
  if (patient) await notifyEmergencyStaff(patient, requestId, roles);
}

const locationForRequest = async (patientId: string, locationShareId?: string) => {
  if (!locationShareId) return null;
  const share = asOne(await LocationShare.findOne({
    _id: locationShareId,
    patient: patientId,
    expiresAt: { $gt: new Date() }
  }).select("lat lng expiresAt consent").lean());
  if (!share || !await Consent.exists({
    _id: share.consent,
    patient: patientId,
    purpose: "location",
    granted: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }]
  })) return null;
  return share;
};

async function latestConsentLocationShare(patientId: string) {
  const shares = await LocationShare.find({ patient: patientId, expiresAt: { $gt: new Date() } })
    .sort({ sharedAt: -1 }).limit(10).select("_id lat lng expiresAt consent").lean();
  for (const share of shares) {
    if (await locationForRequest(patientId, idOf(share._id))) return share;
  }
  return null;
}

export const createEmergencyRequest: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      clientRequestId: z.string().uuid(),
      category: z.enum(["urgent_help", "transport", "other"]),
      message: z.string().trim().min(1).max(500),
      locationShareId: objectId.optional(),
      emergencyContactName: z.string().trim().min(2).max(100).optional(),
      emergencyContactPhone: z.string().trim().regex(/^\+?[0-9\s()-]{7,20}$/).optional(),
      emergencyContactRelationship: z.string().trim().min(2).max(80).optional(),
      emergencyContactConsent: z.literal(true).optional()
    }).strict().refine((value) => {
      const supplied = Boolean(value.emergencyContactName || value.emergencyContactPhone || value.emergencyContactRelationship);
      return !supplied || Boolean(value.emergencyContactName && value.emergencyContactPhone && value.emergencyContactRelationship && value.emergencyContactConsent);
    }, "Complete emergency contact information and record consent to share it.").parse(req.body);
    const { patient, ambiguous } = await findOwnEmergencyPatient(req.user!.phone);
    if (!patient) return failure(res, ambiguous ? "PATIENT_LINK_AMBIGUOUS" : "PATIENT_RECORD_NOT_FOUND", ambiguous ? "Contact your care team to resolve the patient record." : "No active patient record is linked to this account.", ambiguous ? 409 : 404);
    const cached = await EmergencyRequest.findOne({ patient: patient._id, clientRequestId: body.clientRequestId });
    if (cached) {
      await notifyEmergencyStaff(patient, cached._id.toString(), ["asha_worker", "doctor", "district_admin", "hospital_manager", "system_admin"]);
      await queuePatientNotification({
        eventKey: `emergency:${cached._id}`,
        patientId: patient._id.toString(),
        template: "emergency_request_submitted"
      });
      return res.json({ request: { id: cached._id.toString(), status: cached.status }, disclaimer: "This application does not dispatch emergency services. Call your local emergency number or go to the nearest facility." });
    }
    if (body.locationShareId && !await locationForRequest(patient._id.toString(), body.locationShareId)) {
      return failure(res, "LOCATION_CONSENT_REQUIRED", "Only an active, consented location share can be attached to a request.", 403);
    }
    const locationShare = body.locationShareId;
    const now = new Date();
    const item = await EmergencyRequest.create({
      patient: patient._id,
      clientRequestId: body.clientRequestId,
      category: body.category,
      message: body.message,
      locationShare,
      ...(body.emergencyContactConsent ? {
        emergencyContactEncrypted: encrypt(JSON.stringify({
          name: body.emergencyContactName,
          phone: body.emergencyContactPhone,
          relationship: body.emergencyContactRelationship
        })),
        emergencyContactConsentAt: now,
        emergencyContactConsentVersion: "emergency-contact-v1"
      } : {}),
      status: "submitted",
      statusHistory: [{ status: "submitted", changedBy: req.user!.id, changedAt: now }]
    });
    await AuditLog.create({ actor: req.user!.id, action: "emergency_request_created", resource: "EmergencyRequest", resourceId: item._id.toString(), ip: req.ip, metadata: { category: item.category, locationShared: Boolean(locationShare) } });
    await notifyEmergencyStaff(patient, item._id.toString(), ["asha_worker", "doctor", "district_admin", "hospital_manager", "system_admin"]);
    await queuePatientNotification({
      eventKey: `emergency:${item._id}`,
      patientId: patient._id.toString(),
      template: "emergency_request_submitted"
    });
    res.status(201).json({ request: { id: item._id.toString(), status: item.status }, disclaimer: "This application does not dispatch emergency services. Call your local emergency number or go to the nearest facility." });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return failure(res, "DUPLICATE_REQUEST", "This SOS request was already received.", 409);
    next(error);
  }
};

async function serializeEmergency(item: InstanceType<typeof EmergencyRequest>, patient: PatientForEmergency, staff = false) {
  const location = item.locationShare ? await locationForRequest(patient._id.toString(), item.locationShare.toString()) : null;
  const statusHistory = item.statusHistory as Array<{ status: string; changedBy: Types.ObjectId; changedAt: Date }>;
  const contactAttempts = item.contactAttempts as Array<{ _id: Types.ObjectId; attemptedAt: Date; channel: string; outcome: string; noteEncrypted?: string }>;
  const escalations = item.escalations as Array<{ _id: Types.ObjectId; escalatedAt: Date; actor: Types.ObjectId; assignedTo?: Types.ObjectId; reasonEncrypted: string }>;
  return {
    id: item._id.toString(),
    patientCode: patient.patientCode,
    category: item.category,
    message: item.message,
    status: item.status,
    assignedTo: item.assignedTo?.toString(),
    contactAvailable: Boolean(item.emergencyContactConsentAt && item.emergencyContactEncrypted && !["resolved", "cancelled"].includes(item.status)),
    ...(staff ? {
      resolutionNote: item.resolutionNoteEncrypted ? decrypt(item.resolutionNoteEncrypted) : item.resolutionNote,
      statusHistory: statusHistory.map((entry) => ({ status: entry.status, changedBy: entry.changedBy.toString(), changedAt: entry.changedAt })),
      contactAttempts: contactAttempts.map((entry) => ({
        id: entry._id.toString(),
        attemptedAt: entry.attemptedAt,
        channel: entry.channel,
        outcome: entry.outcome,
        note: entry.noteEncrypted ? decrypt(entry.noteEncrypted) : undefined
      })),
      escalations: escalations.map((entry) => ({
        id: entry._id.toString(),
        escalatedAt: entry.escalatedAt,
        actor: entry.actor.toString(),
        assignedTo: entry.assignedTo?.toString(),
        reason: decrypt(entry.reasonEncrypted)
      }))
    } : {}),
    location: location ? { lat: location.lat, lng: location.lng, expiresAt: location.expiresAt } : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

export const listEmergencyRequests: RequestHandler = async (req, res, next) => {
  try {
    const rows = await EmergencyRequest.find({ status: { $in: ["submitted", "open", "assigned", "acknowledged"] } })
      .select("+resolutionNoteEncrypted +emergencyContactEncrypted")
      .sort({ createdAt: 1 }).limit(100).populate({ path: "patient", select: "patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId" });
    const visible = await Promise.all(rows.flatMap((item) => {
      const patient = item.patient as unknown as PatientForEmergency;
      return patient && canAccessEmergencyPatient(patient, req.user!).then((allowed) => allowed ? serializeEmergency(item, patient, true) : null);
    }));
    res.setHeader("Cache-Control", "no-store").json({ requests: visible.filter(Boolean), notice: "This dashboard coordinates requests only; it is not an emergency dispatch service." });
  } catch (error) { next(error); }
};

export const listOwnEmergencyRequests: RequestHandler = async (req, res, next) => {
  try {
    const { patient, ambiguous } = await findOwnEmergencyPatient(req.user!.phone);
    if (!patient) return failure(res, ambiguous ? "PATIENT_LINK_AMBIGUOUS" : "PATIENT_RECORD_NOT_FOUND", ambiguous ? "Contact your care team to resolve the patient record." : "No active patient record is linked to this account.", ambiguous ? 409 : 404);
    const items = await EmergencyRequest.find({ patient: patient._id }).sort({ createdAt: -1 }).limit(20);
    const requests = await Promise.all(items.map((item) => serializeEmergency(item, patient)));
    res.setHeader("Cache-Control", "no-store").json({ requests, notice: "This application does not dispatch emergency services." });
  } catch (error) { next(error); }
};

export const emergencyContactDetails: RequestHandler = async (req, res, next) => {
  try {
    const item = await EmergencyRequest.findById(String(req.params.requestId)).select("+emergencyContactEncrypted");
    if (!item) return failure(res, "NOT_FOUND", "Emergency request not found.", 404);
    const patient = await Patient.findById(item.patient).select("patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId");
    if (!patient || !await canAccessEmergencyPatient(patient, req.user!)) return failure(res, "FORBIDDEN", "You cannot access this request.", 403);
    if (["resolved", "cancelled"].includes(item.status) || !item.emergencyContactConsentAt || !item.emergencyContactEncrypted) {
      return failure(res, "CONTACT_UNAVAILABLE", "The patient has not shared an emergency contact for this active request.", 404);
    }
    const contact = JSON.parse(decrypt(item.emergencyContactEncrypted)) as { name: string; phone: string; relationship: string };
    await AuditLog.create({
      actor: req.user!.id,
      action: "emergency_contact_details_accessed",
      resource: "EmergencyRequest",
      resourceId: item._id.toString(),
      ip: req.ip,
      metadata: { patientId: patient._id.toString() }
    });
    res.setHeader("Cache-Control", "no-store").json({ contact, consentAt: item.emergencyContactConsentAt });
  } catch (error) { next(error); }
};

export const recordEmergencyContactAttempt: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      channel: z.enum(["phone", "inapp", "sms"]),
      outcome: z.enum(["reached", "no_answer", "unavailable", "not_attempted"]),
      note: z.string().trim().max(500).optional()
    }).strict().parse(req.body);
    const item = await EmergencyRequest.findById(String(req.params.requestId)).select("+emergencyContactEncrypted");
    if (!item) return failure(res, "NOT_FOUND", "Emergency request not found.", 404);
    const patient = await Patient.findById(item.patient).select("patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId");
    if (!patient || !await canAccessEmergencyPatient(patient, req.user!)) return failure(res, "FORBIDDEN", "You cannot access this request.", 403);
    if (["resolved", "cancelled"].includes(item.status)) return failure(res, "REQUEST_CLOSED", "Contact history cannot be changed for a closed request.", 409);
    if (!item.emergencyContactConsentAt || !item.emergencyContactEncrypted) return failure(res, "CONTACT_UNAVAILABLE", "The patient has not shared an emergency contact for this request.", 409);
    item.contactAttempts.push({
      actor: new Types.ObjectId(req.user!.id),
      attemptedAt: new Date(),
      channel: body.channel,
      outcome: body.outcome,
      ...(body.note ? { noteEncrypted: encrypt(body.note) } : {})
    });
    await item.save();
    await AuditLog.create({ actor: req.user!.id, action: "emergency_contact_attempt_recorded", resource: "EmergencyRequest", resourceId: item._id.toString(), ip: req.ip, metadata: { channel: body.channel, outcome: body.outcome } });
    res.status(201).json({ request: await serializeEmergency(item, patient, true) });
  } catch (error) { next(error); }
};

export const escalateEmergencyRequest: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      reason: z.string().trim().min(3).max(500),
      assignedTo: objectId.optional()
    }).strict().parse(req.body);
    const item = await EmergencyRequest.findById(String(req.params.requestId)).select("+resolutionNoteEncrypted +emergencyContactEncrypted");
    if (!item) return failure(res, "NOT_FOUND", "Emergency request not found.", 404);
    const patient = await Patient.findById(item.patient).select("patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId");
    if (!patient || !await canAccessEmergencyPatient(patient, req.user!)) return failure(res, "FORBIDDEN", "You cannot access this request.", 403);
    if (["resolved", "cancelled"].includes(item.status)) return failure(res, "REQUEST_CLOSED", "A closed request cannot be escalated.", 409);
    if (body.assignedTo) {
      const profile = await DoctorProfile.findOne({
        user: body.assignedTo,
        $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }]
      }).select("user").populate({ path: "user", match: { role: "doctor", status: "active" }, select: "_id" });
      if (!profile?.user) return failure(res, "INVALID_ASSIGNEE", "The assignee must be an active verified doctor.");
      const assignedUser = await User.findById(body.assignedTo).select("_id assignments");
      const assignments = (assignedUser?.assignments ?? []) as Array<{ mandal?: string; phc?: string; habitation?: string }>;
      const assignmentsMatch = assignments.some((assignment) =>
        Boolean((assignment.mandal && (assignment.mandal === idOf(patient.mandalId) || assignment.mandal.toLocaleLowerCase() === patient.mandal?.toLocaleLowerCase()))
          || (assignment.phc && assignment.phc === idOf(patient.phcId))
          || (assignment.habitation && assignment.habitation === idOf(patient.habitationId))));
      if (idOf(patient.createdBy) !== body.assignedTo && !assignmentsMatch) {
        return failure(res, "ASSIGNEE_OUTSIDE_SCOPE", "The doctor is not assigned to the patient's service area.", 403);
      }
      item.assignedTo = new Types.ObjectId(body.assignedTo);
      item.assignedBy = new Types.ObjectId(req.user!.id);
      item.status = "assigned";
      item.statusHistory.push({ status: "assigned", changedBy: new Types.ObjectId(req.user!.id), changedAt: new Date() });
    }
    item.escalations.push({
      actor: new Types.ObjectId(req.user!.id),
      escalatedAt: new Date(),
      reasonEncrypted: encrypt(body.reason),
      ...(body.assignedTo ? { assignedTo: new Types.ObjectId(body.assignedTo) } : {})
    });
    await item.save();
    await notifyEmergencyStaff(patient, item._id.toString(), ["district_admin", "hospital_manager", "system_admin"], "escalated");
    if (body.assignedTo) {
      const assignee = await User.findById(body.assignedTo).select("language locale");
      await Notification.updateOne(
        { dedupeKey: `emergency:${item._id}:escalation-assigned:${body.assignedTo}` },
        { $setOnInsert: {
          user: body.assignedTo,
          patient: item.patient,
          channel: "inapp",
          template: "emergency_request_assigned",
          language: assignee?.language ?? assignee?.locale ?? "en",
          variables: { requestId: item._id.toString() },
          dedupeKey: `emergency:${item._id}:escalation-assigned:${body.assignedTo}`
        } },
        { upsert: true }
      );
    }
    await AuditLog.create({
      actor: req.user!.id,
      action: "emergency_request_escalated",
      resource: "EmergencyRequest",
      resourceId: item._id.toString(),
      ip: req.ip,
      metadata: { reassigned: Boolean(body.assignedTo) }
    });
    res.status(201).json({ request: await serializeEmergency(item, patient, true), notice: "This application does not dispatch emergency services." });
  } catch (error) { next(error); }
};

export const updateEmergencyRequest: RequestHandler = async (req, res, next) => {
  try {
    const body = z.object({
      status: z.enum(["assigned", "acknowledged", "resolved", "cancelled"]),
      assignedTo: objectId.optional(),
      resolutionNote: z.string().trim().max(500).optional()
    }).strict().parse(req.body);
    const item = await EmergencyRequest.findById(String(req.params.requestId)).select("+resolutionNoteEncrypted");
    if (!item) return failure(res, "NOT_FOUND", "Emergency request not found.", 404);
    const patient = await Patient.findById(item.patient).select("patientCode createdBy phoneHash mandal mandalId phcId villageId habitationId");
    if (!patient || !await canAccessEmergencyPatient(patient, req.user!)) return failure(res, "FORBIDDEN", "You cannot access this request.", 403);
    const transitions: Record<string, string[]> = { submitted: ["assigned", "cancelled"], open: ["assigned", "cancelled"], assigned: ["acknowledged", "cancelled"], acknowledged: ["resolved", "cancelled"] };
    if (!transitions[item.status]?.includes(body.status)) return failure(res, "INVALID_EMERGENCY_TRANSITION", "This request status change is not allowed.", 409);
    if (req.user!.role === "doctor" && (
      (item.assignedTo && item.assignedTo.toString() !== req.user!.id)
      || (body.status === "assigned" && body.assignedTo !== req.user!.id)
      || (body.status !== "assigned" && item.assignedTo?.toString() !== req.user!.id)
    )) return failure(res, "ASSIGNED_DOCTOR_REQUIRED", "Doctors may only claim requests in their care area and update requests assigned to them.", 403);
    if (body.status === "assigned") {
      if (!body.assignedTo) return failure(res, "ASSIGNEE_REQUIRED", "Select a verified doctor to assign this request.");
      const profile = await DoctorProfile.findOne({
        user: body.assignedTo,
        $or: [{ verificationStatus: "verified" }, { verificationStatus: { $exists: false } }]
      }).select("user").populate({ path: "user", match: { role: "doctor", status: "active" }, select: "_id" });
      if (!profile?.user) return failure(res, "INVALID_ASSIGNEE", "The assignee must be an active verified doctor.");
      const assignedUser = await User.findById(body.assignedTo).select("_id assignments");
      const assignments = (assignedUser?.assignments ?? []) as Array<{ mandal?: string; phc?: string; habitation?: string }>;
      const assignmentsMatch = assignments.some((assignment) =>
        Boolean((assignment.mandal && (assignment.mandal === idOf(patient.mandalId) || assignment.mandal.toLocaleLowerCase() === patient.mandal?.toLocaleLowerCase()))
          || (assignment.phc && assignment.phc === idOf(patient.phcId))
          || (assignment.habitation && assignment.habitation === idOf(patient.habitationId))));
      if (idOf(patient.createdBy) !== body.assignedTo && !assignmentsMatch) {
        return failure(res, "ASSIGNEE_OUTSIDE_SCOPE", "The doctor is not assigned to the patient's service area.", 403);
      }
      item.assignedTo = new Types.ObjectId(body.assignedTo);
      item.assignedBy = new Types.ObjectId(req.user!.id);
    } else if (body.assignedTo) {
      return failure(res, "INVALID_ASSIGNEE", "An assignee can only be set while assigning the request.");
    }
    item.status = body.status;
    if (body.resolutionNote !== undefined) {
      item.resolutionNoteEncrypted = body.resolutionNote ? encrypt(body.resolutionNote) : undefined;
      item.resolutionNote = undefined;
    }
    item.statusHistory.push({ status: item.status, changedBy: new Types.ObjectId(req.user!.id), changedAt: new Date() });
    await item.save();
    if (body.status === "assigned" && item.assignedTo) {
      const assignee = await User.findById(item.assignedTo).select("locale language");
      await Notification.create({
        user: item.assignedTo,
        patient: item.patient,
        channel: "inapp",
        template: "emergency_request_assigned",
        language: assignee?.locale ?? assignee?.language ?? "en",
        variables: { requestId: item._id.toString() },
        dedupeKey: `emergency:${item._id}:${item.assignedTo}`
      });
    }
    await AuditLog.create({ actor: req.user!.id, action: "emergency_request_status_updated", resource: "EmergencyRequest", resourceId: item._id.toString(), ip: req.ip, metadata: { status: item.status, assigned: Boolean(item.assignedTo) } });
    res.json({ request: await serializeEmergency(item, patient) });
  } catch (error) { next(error); }
};

export const cancelOwnEmergencyRequest: RequestHandler = async (req, res, next) => {
  try {
    const { patient, ambiguous } = await findOwnEmergencyPatient(req.user!.phone);
    if (!patient) return failure(res, ambiguous ? "PATIENT_LINK_AMBIGUOUS" : "PATIENT_RECORD_NOT_FOUND", ambiguous ? "Contact your care team to resolve the patient record." : "No active patient record is linked to this account.", ambiguous ? 409 : 404);
    const item = await EmergencyRequest.findOne({ _id: String(req.params.requestId), patient: patient._id });
    if (!item) return failure(res, "NOT_FOUND", "Emergency request not found.", 404);
    if (!["submitted", "open", "assigned"].includes(item.status)) return failure(res, "INVALID_EMERGENCY_TRANSITION", "This request can no longer be cancelled.", 409);
    item.status = "cancelled";
    item.statusHistory.push({ status: "cancelled", changedBy: new Types.ObjectId(req.user!.id), changedAt: new Date() });
    await item.save();
    await AuditLog.create({ actor: req.user!.id, action: "emergency_request_cancelled", resource: "EmergencyRequest", resourceId: item._id.toString(), ip: req.ip });
    res.json({ request: { id: item._id.toString(), status: item.status } });
  } catch (error) { next(error); }
};

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const emergencyFacilities: RequestHandler = async (req, res, next) => {
  try {
    const { patient, ambiguous } = await findOwnEmergencyPatient(req.user!.phone);
    if (!patient) return failure(res, ambiguous ? "PATIENT_LINK_AMBIGUOUS" : "PATIENT_RECORD_NOT_FOUND", ambiguous ? "Contact your care team to resolve the patient record." : "No active patient record is linked to this account.", ambiguous ? 409 : 404);
    const location = await latestConsentLocationShare(patient._id.toString());
    const hospitals = await Hospital.find({ active: true }).select("name code type address phone lat lng services workingHours").sort({ name: 1 }).limit(100).lean();
    const facilities = hospitals.map((hospital) => ({
      id: idOf(hospital._id),
      name: hospital.name,
      code: hospital.code,
      type: hospital.type,
      address: hospital.address,
      phone: hospital.phone,
      services: hospital.services,
      lat: hospital.lat,
      lng: hospital.lng,
      distanceKm: location && typeof hospital.lat === "number" && typeof hospital.lng === "number"
        ? Math.round(distanceKm(location.lat, location.lng, hospital.lat, hospital.lng) * 10) / 10
        : null,
      availability: facilityAvailability(hospital.workingHours)
    })).sort((a, b) => a.distanceKm === null ? (b.distanceKm === null ? a.name.localeCompare(b.name) : 1)
      : b.distanceKm === null ? -1 : a.distanceKm - b.distanceKm);
    res.setHeader("Cache-Control", "no-store").json({
      facilities,
      locationUsed: Boolean(location),
      notice: location
        ? "Distances use your most recent consented location. This is not an emergency response service."
        : "Share your location with explicit consent to calculate distances. This directory is not an emergency response service."
    });
  } catch (error) { next(error); }
};
