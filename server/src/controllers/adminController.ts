import type { RequestHandler } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { District, Habitation, Hospital, Mandal, Phc, Village } from "../models/Geo.js";
import { User } from "../models/User.js";
import { AuditLog } from "../models/AuditLog.js";
import { Appointment } from "../models/Appointment.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Notification } from "../models/Notification.js";
import { hashToken } from "../services/tokens.js";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const hospitalFields = z.object({
  name: z.string().trim().min(2).max(200),
  code: z.string().trim().min(2).max(50).optional(),
  district: objectIdSchema.optional(),
  mandal: z.string().trim().max(100).optional(),
  mandalId: objectIdSchema.optional(),
  address: z.string().trim().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().trim().max(30).optional(),
  ownershipType: z.enum(["government", "private"]).optional(),
  specialties: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  services: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  workingHours: z.record(z.string().max(40), z.unknown()).optional(),
  videoEnabled: z.boolean().optional(),
  type: z.enum(["PHC", "CHC", "AreaHospital", "DistrictHospital", "Private", "DiagnosticCentre", "government", "private", "referral"]).optional(),
  active: z.boolean().optional()
}).strict();
const coordinatesMatch = <T extends { lat?: number; lng?: number }>(schema: z.ZodType<T>) =>
  schema.refine((value) => (value.lat === undefined) === (value.lng === undefined), "Latitude and longitude must be provided together.");
const hospitalUpdateInput = coordinatesMatch(hospitalFields.partial());
const hospitalCreateInput = coordinatesMatch(hospitalFields.extend({
  code: z.string().trim().min(2).max(50),
  type: z.enum(["PHC", "CHC", "AreaHospital", "DistrictHospital", "Private", "DiagnosticCentre", "government", "private", "referral"])
}));
const assignmentSchema = z.object({ scope: z.string().optional(), district: z.string().optional(), mandal: z.string().optional(), village: z.string().optional(), habitation: z.string().optional(), phc: z.string().optional(), hospital: z.string().optional() });
const userInput = z.object({ name: z.string().min(2).max(100).optional(), username: z.string().min(3).max(50).optional(), email: z.string().email().optional(), phone: z.string().min(7).optional(), password: z.string().min(8), role: z.enum(["doctor", "district_admin"]), subRole: z.string().optional(), assignments: z.array(assignmentSchema).optional() })
  .refine((v) => Boolean(v.name || v.username), "Username is required.")
  .refine((v) => Boolean(v.email || v.phone), "Email or phone is required.")
  .refine((v) => v.role !== "doctor" || Boolean(v.username && v.email && v.phone), "Doctor accounts require username, email, and phone.")
  .refine((v) => !v.subRole || (v.role === "doctor" && ["medical_officer", "specialist"].includes(v.subRole)), "Only doctor subroles may be assigned to doctor accounts.");
const parse = <T>(schema: z.ZodType<T>, body: unknown): T | null => { const result = schema.safeParse(body); return result.success ? result.data : null; };
type DistrictScope = { districtIds: string[]; districtCodes: string[]; mandalIds: string[]; mandalLabels: string[]; phcIds: string[]; villageIds: string[]; habitationIds: string[]; hospitalIds: string[]; hospitalCodes: string[] };

const resolveDistrictScope = async (req: Parameters<RequestHandler>[0]): Promise<DistrictScope | null> => {
  if (req.user?.role !== "district_admin") return null;
  const districtValues = (req.user.assignments ?? []).flatMap((a) => a.district ? [a.district] : []);
  const districtQuery = [
    ...(districtValues.some((value) => objectIdSchema.safeParse(value).success) ? [{ _id: { $in: districtValues.filter((value) => objectIdSchema.safeParse(value).success) } }] : []),
    { code: { $in: districtValues } }
  ];
  const districts = districtValues.length ? await District.find({ $or: districtQuery }).select("_id code").lean() : [];
  const districtIds = districts.map((item) => String(item._id));
  if (!districtIds.length) return { districtIds: [], districtCodes: [], mandalIds: [], mandalLabels: [], phcIds: [], villageIds: [], habitationIds: [], hospitalIds: [], hospitalCodes: [] };
  const [mandals, phcs, villages, habitations, hospitals] = await Promise.all([
    Mandal.find({ district: { $in: districtIds } }).select("_id code name name_en").lean(),
    Phc.find({ district: { $in: districtIds } }).select("_id code name name_en").lean(),
    Village.find({ district: { $in: districtIds } }).select("_id code name name_en").lean(),
    Habitation.find({ district: { $in: districtIds } }).select("_id code name name_en").lean(),
    Hospital.find({ $or: [{ district: { $in: districtIds } }, { mandalId: { $in: await Mandal.find({ district: { $in: districtIds } }).distinct("_id") } }] }).select("_id code").lean()
  ]);
  return {
    districtIds,
    districtCodes: districts.map((item) => item.code),
    mandalIds: mandals.map((item) => String(item._id)),
    mandalLabels: mandals.flatMap((item) => [item.code, item.name, item.name_en].filter((value): value is string => Boolean(value))),
    phcIds: phcs.map((item) => String(item._id)),
    villageIds: villages.map((item) => String(item._id)),
    habitationIds: habitations.map((item) => String(item._id)),
    hospitalIds: hospitals.map((item) => String(item._id)),
    hospitalCodes: hospitals.flatMap((item) => item.code ? [item.code] : [])
  };
};

const districtFilter = (scope: DistrictScope, base: Record<string, unknown>, key: "hospitals" | "doctors") => {
  if (!scope.districtIds.length) return { _id: null };
  const scoped = key === "hospitals"
    ? { $or: [{ district: { $in: scope.districtIds } }, { mandalId: { $in: scope.mandalIds } }, { mandal: { $in: scope.mandalIds } }] }
    : { $or: [
      { "assignments.district": { $in: [...scope.districtIds, ...scope.districtCodes] } },
      { "assignments.mandal": { $in: [...scope.mandalIds, ...scope.mandalLabels] } },
      { "assignments.phc": { $in: scope.phcIds } },
      { "assignments.village": { $in: scope.villageIds } },
      { "assignments.habitation": { $in: scope.habitationIds } },
      { "assignments.hospital": { $in: [...scope.hospitalIds, ...scope.hospitalCodes] } }
    ] };
  return { ...base, $and: [...(Array.isArray(base.$and) ? base.$and as Record<string, unknown>[] : []), scoped] };
};

const assignmentsWithinDistrict = (assignments: z.infer<typeof assignmentSchema>[], scope: DistrictScope) => {
  if (!scope.districtIds.length || !assignments.length) return false;
  const allow = {
    district: new Set([...scope.districtIds, ...scope.districtCodes]),
    mandal: new Set([...scope.mandalIds, ...scope.mandalLabels]),
    phc: new Set(scope.phcIds),
    village: new Set(scope.villageIds),
    habitation: new Set(scope.habitationIds),
    hospital: new Set([...scope.hospitalIds, ...scope.hospitalCodes])
  };
  return assignments.every((assignment) => {
    const values = Object.entries(assignment).filter(([key, value]) => key !== "scope" && value);
    return values.length > 0 && values.every(([key, value]) => key in allow && allow[key as keyof typeof allow].has(value as string));
  });
};

const setupToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) };
};

export const auditLogQuerySchema = z.object({
  actor: objectIdSchema.optional(),
  action: z.string().trim().min(1).max(80).optional(),
  resource: z.string().trim().min(1).max(120).optional(),
  resourceId: z.string().trim().min(1).max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
}).strict().refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
  message: "from must be earlier than or equal to to"
});

export function publicUserPayload(user: {
  _id: unknown;
  name: string;
  username?: string;
  email?: string;
  phone?: string;
  role: string;
  subRole?: string;
  assignments?: unknown;
  locale?: string;
  language?: string;
  status?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}) {
  return {
    _id: user._id,
    name: user.name,
    ...(user.username ? { username: user.username } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(user.phone ? { phone: user.phone } : {}),
    role: user.role,
    ...(user.subRole ? { subRole: user.subRole } : {}),
    ...(user.assignments ? { assignments: user.assignments } : {}),
    ...(user.locale ? { locale: user.locale } : {}),
    ...(user.language ? { language: user.language } : {}),
    ...(user.status ? { status: user.status } : {}),
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {})
  };
}

export const listHospitals: RequestHandler = async (req, res, next) => { try {
  const query = z.object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(["all", "active", "inactive"]).default("all"),
    district: objectIdSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  }).strict().parse(req.query);
  const filter: Record<string, unknown> = {};
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "i");
    filter.$or = [{ name: expression }, { address: expression }, { code: expression }, { type: expression }];
  }
  if (query.status !== "all") filter.active = query.status === "active";
  if (query.district) filter.district = query.district;
  const scope = await resolveDistrictScope(req);
  const scopedFilter = scope ? districtFilter(scope, filter, "hospitals") : filter;
  const [hospitals, total] = await Promise.all([
    Hospital.find(scopedFilter).sort({ name: 1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Hospital.countDocuments(scopedFilter)
  ]);
  const [profiles, districts, mandals] = await Promise.all([
    DoctorProfile.find({ hospital: { $in: hospitals.map((hospital) => hospital._id) } })
      .select("hospital user")
      .populate("user", "_id role status")
      .lean(),
    District.find({ _id: { $in: hospitals.flatMap((hospital) => hospital.district ? [hospital.district] : []) } }).select("_id name name_en").lean(),
    Mandal.find({ _id: { $in: hospitals.flatMap((hospital) => [hospital.mandal, hospital.mandalId].filter(Boolean)) } }).select("_id name name_en").lean()
  ]);
  const districtNames = new Map(districts.map((district) => [String(district._id), district.name_en ?? district.name]));
  const mandalNames = new Map(mandals.map((mandal) => [String(mandal._id), mandal.name_en ?? mandal.name]));
  const doctorCounts = new Map<string, { doctorCount: number; activeDoctorCount: number }>();
  for (const hospital of hospitals) doctorCounts.set(String(hospital._id), { doctorCount: 0, activeDoctorCount: 0 });
  for (const profile of profiles) {
    const count = doctorCounts.get(String(profile.hospital));
    const doctor = profile.user as { role?: string; status?: string } | null;
    if (!count || doctor?.role !== "doctor") continue;
    count.doctorCount += 1;
    if (doctor.status === "active") count.activeDoctorCount += 1;
  }
  res.json({
    hospitals: hospitals.map((hospital) => ({
      ...hospital,
      ownershipType: hospital.ownershipType ?? (["private", "Private"].includes(hospital.type) ? "private" : "government"),
      districtName: hospital.district ? districtNames.get(String(hospital.district)) : undefined,
      mandalName: hospital.mandalId ? mandalNames.get(String(hospital.mandalId)) : hospital.mandal ? mandalNames.get(String(hospital.mandal)) : undefined,
      ...doctorCounts.get(String(hospital._id))
    })),
    total,
    page: query.page,
    limit: query.limit
  });
} catch (e) { next(e); } };
export const listDoctors: RequestHandler = async (req, res, next) => { try {
  const query = z.object({
    search: z.string().trim().max(100).optional(),
    verificationStatus: z.enum(["draft", "pending", "verified", "rejected", "suspended"]).optional(),
    accountStatus: z.enum(["active", "disabled", "locked"]).optional()
  }).strict().parse(req.query);
  const filter: Record<string, unknown> = { role: "doctor" };
  if (query.accountStatus) filter.status = query.accountStatus;
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "i");
    filter.$or = [{ name: expression }, { username: expression }, { email: expression }, { phone: expression }];
  }
  const scope = await resolveDistrictScope(req);
  const users = await User.find(scope ? districtFilter(scope, filter, "doctors") : filter).select("_id name username email phone role assignments status createdAt").sort({ name: 1 }).lean();
  const profiles = await DoctorProfile.find({ user: { $in: users.map((user) => user._id) } })
    .select("user hospital registrationNo specialty qualification verificationStatus submittedAt documents")
    .populate("hospital", "name code")
    .lean();
  const profileByUser = new Map(profiles.map((profile) => [String(profile.user), {
    registrationNo: profile.registrationNo,
    specialty: profile.specialty,
    qualification: profile.qualification,
    verificationStatus: profile.verificationStatus ?? "verified",
    submittedAt: profile.submittedAt,
    documentCount: req.user?.role === "system_admin" ? profile.documents?.length ?? 0 : undefined,
    hospital: profile.hospital && typeof profile.hospital === "object"
      ? { name: (profile.hospital as { name?: string }).name, code: (profile.hospital as { code?: string }).code }
      : null
  }]));
  const doctors = users.map((user) => ({ ...user, hospitalProfile: profileByUser.get(String(user._id)) ?? null }))
    .filter((user) => !query.verificationStatus || (user.hospitalProfile?.verificationStatus ?? "draft") === query.verificationStatus);
  const statuses = users.map((user) => profileByUser.get(String(user._id))?.verificationStatus ?? "draft");
  const stats = {
    total: users.length,
    active: users.filter((user) => user.status === "active").length,
    draft: statuses.filter((status) => status === "draft").length,
    pending: statuses.filter((status) => status === "pending").length,
    verified: statuses.filter((status) => status === "verified").length,
    rejected: statuses.filter((status) => status === "rejected").length,
    suspended: statuses.filter((status) => status === "suspended").length
  };
  res.json({ doctors, stats });
} catch (e) { next(e); } };

export const getDoctorDetails: RequestHandler = async (req, res, next) => { try {
  const userId = objectIdSchema.parse(req.params.userId);
  const scope = await resolveDistrictScope(req);
  const userFilter = { _id: userId, role: "doctor" };
  const user = await User.findOne(scope ? districtFilter(scope, userFilter, "doctors") : userFilter)
    .select("_id name username email phone role assignments status createdAt")
    .lean();
  if (!user) return res.status(404).json({ error: { code: "DOCTOR_NOT_FOUND", message_en: "Doctor not found." } });
  const profile = await DoctorProfile.findOne({ user: userId }).populate("hospital", "name code active").exec();
  const profileData = profile?.toObject() as {
    _id: unknown;
    registrationNo?: string;
    specialty?: string;
    qualification?: string;
    experienceYears?: number;
    professionalSummary?: string;
    verificationStatus?: string;
    submittedAt?: Date;
    hospital?: unknown;
    documents?: Array<{ _id: unknown; type: string; originalName: string; mimeType?: string; size: number; reviewStatus: string; adminRemarks?: string; uploadedAt: Date; verifiedAt?: Date }>;
    verificationHistory?: Array<{ status: string; reviewer: unknown; note?: string; createdAt: Date }>;
  } | undefined;
  res.json({
    doctor: user,
    profile: profileData ? {
      id: String(profileData._id),
      registrationNo: profileData.registrationNo,
      specialty: profileData.specialty,
      qualification: profileData.qualification,
      experienceYears: profileData.experienceYears,
      professionalSummary: profileData.professionalSummary,
      verificationStatus: profileData.verificationStatus,
      submittedAt: profileData.submittedAt,
      hospital: profileData.hospital,
      documents: req.user?.role === "system_admin" ? (profileData.documents ?? []).map((document) => ({ id: String(document._id), type: document.type, originalName: document.originalName, downloadName: document.mimeType === "image/jpeg" && /\.png$/i.test(document.originalName) ? `${document.originalName.slice(0, -4)}.jpg` : document.originalName, size: document.size, reviewStatus: document.reviewStatus === "accepted" ? "approved" : document.reviewStatus, adminRemarks: document.adminRemarks, uploadedAt: document.uploadedAt, verifiedAt: document.verifiedAt })) : [],
      verificationHistory: req.user?.role === "system_admin" ? profileData.verificationHistory ?? [] : []
    } : null
  });
} catch (e) { next(e); } };

const doctorVerificationDecision = z.object({
  decision: z.enum(["verified", "rejected", "suspended"]),
  note: z.string().trim().max(1000).optional()
}).strict().refine((value) => value.decision === "verified" || Boolean(value.note?.length), "A note is required for rejection or suspension.");
export const reviewDoctorVerification: RequestHandler = async (req, res, next) => { try {
  const userId = objectIdSchema.parse(req.params.userId);
  const body = doctorVerificationDecision.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Provide a valid review decision and a note when rejecting or suspending." } });
  const profile = await DoctorProfile.findOne({ user: userId });
  if (!profile) return res.status(404).json({ error: { code: "DOCTOR_PROFILE_NOT_FOUND", message_en: "Doctor profile not found." } });
  const allowed =
    (profile.verificationStatus === "pending" && ["verified", "rejected"].includes(body.data.decision)) ||
    (profile.verificationStatus === "verified" && body.data.decision === "suspended") ||
    (profile.verificationStatus === "suspended" && body.data.decision === "verified");
  if (!allowed) return res.status(409).json({ error: { code: "INVALID_VERIFICATION_TRANSITION", message_en: "This verification decision is not available in the current state." } });
  if (body.data.decision === "verified") {
    const documentTypes = new Set(profile.documents.map((document: { type: string }) => document.type));
    if (!profile.registrationNo || !profile.specialty || !profile.qualification || !documentTypes.has("registration_certificate") || !documentTypes.has("qualification")) {
      return res.status(409).json({ error: { code: "VERIFICATION_EVIDENCE_INCOMPLETE", message_en: "Required professional details and documents are incomplete." } });
    }
  }
  profile.verificationStatus = body.data.decision;
  profile.verificationHistory.push({ status: body.data.decision, reviewer: req.user!.id, note: body.data.note });
  if (body.data.decision === "verified" || body.data.decision === "rejected") {
    const reviewedAt = new Date();
    for (const document of profile.documents) {
      if (document.reviewStatus !== "pending") continue;
      document.reviewStatus = body.data.decision === "verified" ? "approved" : "rejected";
      document.adminRemarks = body.data.note;
      document.reviewedBy = req.user!.id;
      document.verifiedAt = body.data.decision === "verified" ? reviewedAt : undefined;
    }
  }
  await profile.save();
  await AuditLog.create({ actor: req.user!.id, action: `doctor.verification.${body.data.decision}`, resource: "doctor_profile", resourceId: profile._id.toString(), ip: req.ip, userAgent: req.get("user-agent"), metadata: { doctorId: userId, note: body.data.note } });
  res.json({ verificationStatus: profile.verificationStatus });
} catch (e) { next(e); } };

export const setDoctorStatus: RequestHandler = async (req, res, next) => { try {
  const userId = objectIdSchema.parse(req.params.userId);
  const body = z.object({ status: z.enum(["active", "disabled"]) }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Invalid doctor account status." } });
  const user = await User.findOneAndUpdate(
    { _id: userId, role: "doctor" },
    { $set: { status: body.data.status }, $inc: { tokenVersion: 1 }, $unset: { refreshTokenHash: 1 } },
    { new: true }
  ).select("_id status");
  if (!user) return res.status(404).json({ error: { code: "DOCTOR_NOT_FOUND", message_en: "Doctor not found." } });
  await AuditLog.create({ actor: req.user!.id, action: `doctor.account.${body.data.status}`, resource: "doctor", resourceId: userId, ip: req.ip, userAgent: req.get("user-agent"), metadata: { status: body.data.status } });
  res.json({ id: user._id.toString(), status: user.status });
} catch (e) { next(e); } };
const recordHospitalWrite = (req: Parameters<RequestHandler>[0], action: string, hospitalId: string) =>
  AuditLog.create({
    actor: req.user!.id,
    action,
    resource: "hospital",
    resourceId: hospitalId,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    metadata: { actorRole: req.user!.role, hospitalId, outcome: "success" }
  });

const hospitalLocationIsValid = async (district?: string, mandalId?: string) => {
  if (district && !await District.exists({ _id: district })) return false;
  if (mandalId && !await Mandal.exists({ _id: mandalId, ...(district ? { district } : {}) })) return false;
  return true;
};

export const createHospital: RequestHandler = async (req, res, next) => {
  try {
    const result = hospitalCreateInput.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Provide a valid hospital name, unique Hospital ID, type, and location." } });
    const data = result.data;
    if (!await hospitalLocationIsValid(data.district, data.mandalId)) {
      return res.status(400).json({ error: { code: "INVALID_LOCATION", message_en: "Select a valid district and mandal." } });
    }
    const hospital = await Hospital.create({
      ...data,
      ownershipType: data.ownershipType ?? (["private", "Private"].includes(data.type) ? "private" : "government"),
      code: data.code.trim().toUpperCase()
    });
    await recordHospitalWrite(req, "create", String(hospital._id));
    res.status(201).json({ hospital });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return res.status(409).json({ error: { code: "HOSPITAL_CODE_EXISTS", message_en: "A hospital already uses this Hospital ID." } });
    }
    next(error);
  }
};

export const updateHospital: RequestHandler = async (req, res, next) => {
  try {
    const hospitalId = objectIdSchema.parse(req.params.hospitalId);
    const result = hospitalUpdateInput.safeParse(req.body);
    if (!result.success || !Object.keys(result.data ?? {}).length) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Please check the hospital details." } });
    const data = result.data;
    if (!await hospitalLocationIsValid(data.district, data.mandalId)) {
      return res.status(400).json({ error: { code: "INVALID_LOCATION", message_en: "Select a valid district and mandal." } });
    }
    if (data.code) data.code = data.code.toUpperCase();
    const hospital = await Hospital.findByIdAndUpdate(hospitalId, data, { new: true, runValidators: true });
    if (!hospital) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Hospital not found." } });
    await recordHospitalWrite(req, data.active === undefined ? "update" : data.active ? "activate" : "deactivate", hospitalId);
    res.json({ hospital });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return res.status(409).json({ error: { code: "HOSPITAL_CODE_EXISTS", message_en: "A hospital already uses this Hospital ID." } });
    }
    next(error);
  }
};

export const hospitalOverview: RequestHandler = async (_req, res, next) => {
  try {
    const [totalHospitals, activeHospitals, inactiveHospitals, totalDoctors, activeDoctors, hospitalManagers, hospitals, profiles] = await Promise.all([
      Hospital.countDocuments({}),
      Hospital.countDocuments({ active: true }),
      Hospital.countDocuments({ active: false }),
      User.countDocuments({ role: "doctor" }),
      User.countDocuments({ role: "doctor", status: "active" }),
      User.countDocuments({ role: "hospital_manager" }),
      Hospital.find({}).select("_id name code active type ownershipType").sort({ name: 1 }).lean(),
      DoctorProfile.find({}).select("hospital user").populate("user", "_id role status").lean()
    ]);
    const distribution = new Map<string, { hospitalId: string; hospitalName: string; hospitalCode?: string; type: string; ownershipType: "government" | "private"; doctors: number; activeDoctors: number }>();
    for (const hospital of hospitals) {
      const hospitalId = String(hospital._id);
      distribution.set(hospitalId, {
        hospitalId,
        hospitalName: hospital.name,
        hospitalCode: hospital.code,
        type: hospital.type,
        ownershipType: hospital.ownershipType ?? (["private", "Private"].includes(hospital.type) ? "private" : "government"),
        doctors: 0,
        activeDoctors: 0
      });
    }
    for (const profile of profiles) {
      const hospitalId = profile.hospital.toString();
      const entry = distribution.get(hospitalId);
      const doctor = profile.user as { role?: string; status?: string } | null;
      if (!entry || doctor?.role !== "doctor") continue;
      entry.doctors += 1;
      if (doctor.status === "active") entry.activeDoctors += 1;
    }
    res.json({
      statistics: {
        totalHospitals,
        activeHospitals,
        inactiveHospitals,
        totalDoctors,
        activeDoctors,
        hospitalManagers
      },
      hospitals: [...distribution.values()]
    });
  } catch (error) {
    next(error);
  }
};

export const getHospitalDetails: RequestHandler = async (req, res, next) => {
  try {
    const hospitalId = objectIdSchema.parse(req.params.hospitalId);
    const scope = await resolveDistrictScope(req);
    if (scope && !scope.hospitalIds.includes(hospitalId)) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Hospital not found." } });
    const hospital = await Hospital.findById(hospitalId).lean();
    if (!hospital) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Hospital not found." } });
    const [managers, profiles, upcomingAppointments, completedAppointments, auditLogs] = await Promise.all([
      User.find({ role: "hospital_manager", hospitalId }).select("_id name username email status mfaEnabled createdAt").sort({ name: 1 }).lean(),
      DoctorProfile.find({ hospital: hospitalId }).select("user registrationNo specialty availability").populate("user", "_id name username status").lean(),
      Appointment.countDocuments({ hospital: hospitalId, status: { $in: ["requested", "confirmed", "rescheduled"] }, startAt: { $gte: new Date() } }),
      Appointment.countDocuments({ hospital: hospitalId, status: { $in: ["attended", "assessment_completed"] } }),
      req.user!.role === "system_admin"
        ? AuditLog.find({ $or: [{ resourceId: hospitalId }, { "metadata.hospitalId": hospitalId }] }).sort({ createdAt: -1 }).limit(25).select("actor action resource resourceId metadata createdAt").populate("actor", "name role").lean()
        : Promise.resolve([])
    ]);
    const doctors = profiles.flatMap((profile) => {
      const doctor = profile.user as { _id: { toString(): string }; name?: string; username?: string; status?: string } | null;
      return doctor ? [{
        id: doctor._id.toString(),
        name: doctor.name,
        username: doctor.username,
        status: doctor.status,
        specialty: profile.specialty,
        registrationNo: profile.registrationNo,
        availabilityCount: (profile.availability as Array<{ booked: boolean; start: Date }>).filter((slot) => !slot.booked && slot.start > new Date()).length
      }] : [];
    });
    res.json({
      hospital,
      managers,
      doctors,
      statistics: { assignedDoctors: doctors.length, activeDoctors: doctors.filter((doctor) => doctor.status === "active").length, upcomingAppointments, completedAppointments },
      auditLogs
    });
  } catch (error) {
    next(error);
  }
};
export const deleteHospital: RequestHandler = async (req, res, next) => {
  try {
    const hospitalId = objectIdSchema.parse(req.params.hospitalId);
    if (await User.exists({ role: "hospital_manager", hospitalId })) return res.status(409).json({ error: { code: "HOSPITAL_HAS_MANAGERS", message_en: "Reassign or deactivate hospital managers before deleting this hospital." } });
    const hospital = await Hospital.findByIdAndDelete(hospitalId);
    if (!hospital) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Hospital not found." } });
    await recordHospitalWrite(req, "delete", hospitalId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
export const createUser: RequestHandler = async (req, res, next) => {
  try {
    const data = parse(userInput, req.body);
    if (!data) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Please check the provided values." } });
    if (data.role === "district_admin" && req.user?.role !== "system_admin") return res.status(403).json({ error: { code: "FORBIDDEN", message_en: "Only system administrators can provision district administrators." } });
    if (req.user?.role === "district_admin") {
      const scope = await resolveDistrictScope(req);
      if (!scope || !assignmentsWithinDistrict(data.assignments ?? [], scope)) return res.status(403).json({ error: { code: "OUT_OF_SCOPE", message_en: "The user must be assigned only within your district." } });
    }
    const { password, ...fields } = data;
    const duplicate = await User.exists({ $or: [
      ...(fields.username ? [{ username: fields.username.toLowerCase() }] : []),
      ...(fields.email ? [{ email: fields.email.toLowerCase() }] : []),
      ...(fields.phone ? [{ phone: fields.phone }] : [])
    ] });
    if (duplicate) return res.status(409).json({ error: { code: "USER_EXISTS", message_en: "A user with this username, email, or phone already exists." } });
    const user = await User.create({
      ...fields,
      name: fields.name ?? fields.username!,
      username: fields.username?.toLowerCase(),
      email: fields.email?.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12)
    });
    res.status(201).json({ user: publicUserPayload(user.toObject()) });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return res.status(409).json({ error: { code: "USER_EXISTS", message_en: "A user with this username, email, or phone already exists." } });
    }
    next(error);
  }
};
const ashaWorkerInput = z.object({
  name: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(50),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  phcId: objectIdSchema,
  villageId: objectIdSchema
}).strict().refine((value) => Boolean(value.email || value.phone), "Provide an email or phone number.");

export const ashaWorkerOptions: RequestHandler = async (_req, res, next) => {
  try {
    const [phcs, villages] = await Promise.all([
      Phc.find({ active: true }).select("_id name name_en district mandal").sort({ name: 1 }).limit(1000).lean(),
      Village.find({}).select("_id name name_en district mandal phc").sort({ name: 1 }).limit(5000).lean()
    ]);
    res.setHeader("Cache-Control", "no-store").json({ phcs, villages });
  } catch (error) { next(error); }
};

export const listAshaWorkers: RequestHandler = async (_req, res, next) => {
  try {
    const workers = await User.find({ role: "asha_worker" })
      .select("_id name username email phone role assignments status mfaEnabled createdAt")
      .sort({ name: 1 }).limit(1000).lean();
    res.json({ workers });
  } catch (error) { next(error); }
};

export const createAshaWorker: RequestHandler = async (req, res, next) => {
  try {
    const parsed = ashaWorkerInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Provide valid ASHA worker details and a matching PHC and village." } });
    const data = parsed.data;
    const [phc, village] = await Promise.all([
      Phc.findOne({ _id: data.phcId, active: true }).select("_id district mandal"),
      Village.findById(data.villageId).select("_id district mandal phc")
    ]);
    if (!phc || !village || village.mandal.toString() !== phc.mandal.toString()
      || village.district.toString() !== phc.district.toString()
      || (village.phc && village.phc.toString() !== phc._id.toString())) {
      return res.status(400).json({ error: { code: "INVALID_ASSIGNMENT", message_en: "The selected village must belong to the selected PHC and district." } });
    }
    const username = data.username.toLowerCase();
    const email = data.email?.toLowerCase();
    const duplicate = await User.exists({ $or: [
      { username },
      ...(email ? [{ email }] : []),
      ...(data.phone ? [{ phone: data.phone }] : [])
    ] });
    if (duplicate) return res.status(409).json({ error: { code: "USER_EXISTS", message_en: "A user with this username, email, or phone already exists." } });
    const invite = setupToken();
    const worker = await User.create({
      name: data.name,
      username,
      email,
      phone: data.phone,
      role: "asha_worker",
      subRole: "asha",
      assignments: [{
        scope: "village",
        district: phc.district.toString(),
        mandal: phc.mandal.toString(),
        phc: phc._id.toString(),
        village: village._id.toString()
      }],
      passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12),
      passwordSetupTokenHash: invite.tokenHash,
      passwordSetupExpiresAt: invite.expiresAt,
      mfaEnabled: false,
      tokenVersion: 0
    });
    await AuditLog.create({
      actor: req.user!.id,
      action: "asha_worker.created",
      resource: "asha_worker",
      resourceId: worker._id.toString(),
      ip: req.ip,
      metadata: { phcId: phc._id.toString(), villageId: village._id.toString() }
    });
    res.status(201).json({ worker: publicUserPayload(worker.toObject()), setupToken: invite.token, setupExpiresAt: invite.expiresAt });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return res.status(409).json({ error: { code: "USER_EXISTS", message_en: "A user with this username, email, or phone already exists." } });
    }
    next(error);
  }
};

export const setAshaWorkerStatus: RequestHandler = async (req, res, next) => {
  try {
    const userId = objectIdSchema.parse(req.params.userId);
    const parsed = z.object({ status: z.enum(["active", "disabled"]) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Invalid ASHA worker account status." } });
    const worker = await User.findOneAndUpdate(
      { _id: userId, role: "asha_worker" },
      { $set: { status: parsed.data.status }, $inc: { tokenVersion: 1 }, $unset: { refreshTokenHash: 1 } },
      { new: true }
    ).select("_id status");
    if (!worker) return res.status(404).json({ error: { code: "ASHA_WORKER_NOT_FOUND", message_en: "ASHA worker not found." } });
    await AuditLog.create({ actor: req.user!.id, action: `asha_worker.${parsed.data.status}`, resource: "asha_worker", resourceId: userId, ip: req.ip });
    res.json({ id: worker._id.toString(), status: worker.status });
  } catch (error) { next(error); }
};
const doctorHospitalProfileInput = z.object({
  hospitalId: objectIdSchema,
  registrationNo: z.string().trim().min(2).max(80),
  specialty: z.string().trim().min(2).max(120)
}).strict();
export const assignDoctorHospitalProfile: RequestHandler = async (req, res, next) => {
  try {
    const userId = objectIdSchema.parse(req.params.userId);
    const body = doctorHospitalProfileInput.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Provide a valid hospital, registration number, and specialty." } });
    const [doctor, hospital, existingProfile] = await Promise.all([
      User.findOne({ _id: userId, role: "doctor", status: "active" }).select("_id name"),
      Hospital.findOne({ _id: body.data.hospitalId, active: true }).select("_id"),
      DoctorProfile.findOne({ user: userId })
    ]);
    if (!doctor) return res.status(404).json({ error: { code: "DOCTOR_NOT_FOUND", message_en: "Active doctor account not found." } });
    if (!hospital) return res.status(404).json({ error: { code: "HOSPITAL_NOT_FOUND", message_en: "Active hospital not found." } });
    if (existingProfile?.hospital) return res.status(409).json({ error: { code: "DOCTOR_PROFILE_EXISTS", message_en: "This doctor already has a hospital assignment. Reassignment requires an approved transfer." } });
    if (existingProfile?.registrationNo && existingProfile.registrationNo !== body.data.registrationNo) {
      return res.status(409).json({ error: { code: "DOCTOR_DETAILS_MISMATCH", message_en: "The supplied registration number does not match the doctor's profile." } });
    }
    if (existingProfile?.specialty && existingProfile.specialty !== body.data.specialty) {
      return res.status(409).json({ error: { code: "DOCTOR_DETAILS_MISMATCH", message_en: "The supplied specialty does not match the doctor's profile." } });
    }
    const profile = existingProfile ?? new DoctorProfile({ user: userId, verificationStatus: "draft" });
    profile.hospital = hospital._id;
    profile.registrationNo = profile.registrationNo ?? body.data.registrationNo.toUpperCase();
    profile.specialty = profile.specialty ?? body.data.specialty;
    await profile.save();
    await Notification.create({
      user: doctor._id,
      channel: "inapp",
      template: "doctor_hospital_assignment",
      language: "en",
      variables: { hospitalId: hospital._id.toString() },
      status: "queued"
    });
    await AuditLog.create({
      actor: req.user!.id,
      action: "assign",
      resource: "doctor_profile",
      resourceId: profile._id.toString(),
      metadata: { actorRole: req.user!.role, hospitalId: hospital._id.toString(), doctorId: userId, outcome: "success" },
      ip: req.ip
    });
    res.status(201).json({ profile: { id: profile._id.toString(), userId, hospitalId: hospital._id.toString(), registrationNo: profile.registrationNo, specialty: profile.specialty } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return res.status(409).json({ error: { code: "DOCTOR_PROFILE_CONFLICT", message_en: "A doctor profile already uses this account or registration number." } });
    }
    next(error);
  }
};
export const patchUserAssignment: RequestHandler = async (req, res, next) => { try {
  const userId = objectIdSchema.parse(req.params.userId);
  const body = z.object({ assignments: z.array(assignmentSchema) }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Invalid assignments." } });
  const target = await User.findById(userId).select("_id role");
  if (!target || target.role === "employee" || target.role === "hospital_manager" || target.role === "system_admin") return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "User not found." } });
  if (req.user?.role === "district_admin") {
    if (target.role !== "doctor") return res.status(403).json({ error: { code: "FORBIDDEN", message_en: "This account cannot be assigned by a district administrator." } });
    const scope = await resolveDistrictScope(req);
    if (!scope || !assignmentsWithinDistrict(body.data.assignments, scope)) return res.status(403).json({ error: { code: "OUT_OF_SCOPE", message_en: "Assignments must remain within your district." } });
  }
  const user = await User.findByIdAndUpdate(userId, { $set: { assignments: body.data.assignments } }, { new: true }).select("_id name email phone role assignments");
  if (!user) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "User not found." } });
  res.json({ user });
} catch (e) { next(e); } };

export const hospitalManagerInputSchema = z.object({
  hospitalId: objectIdSchema,
  name: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(50),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(7).max(20).optional()
}).strict();
export const hospitalManagerStatusSchema = z.object({ status: z.enum(["active", "disabled"]) }).strict();
export const listHospitalManagers: RequestHandler = async (req, res, next) => { try {
  const search = z.string().trim().max(100).optional().parse(req.query.search);
  const filter: Record<string, unknown> = { role: "hospital_manager" };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "i");
    filter.$or = [{ name: expression }, { username: expression }, { email: expression }, { phone: expression }];
  }
  const managers = await User.find(filter).select("_id name username email phone status mfaEnabled hospitalId createdAt updatedAt").populate("hospitalId", "name code active").sort({ name: 1 }).lean();
  res.json({ managers });
} catch (e) { next(e); } };

export const createHospitalManager: RequestHandler = async (req, res, next) => { try {
  const data = hospitalManagerInputSchema.safeParse(req.body);
  if (!data.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Please check the manager details." } });
  const hospital = await Hospital.findOne({ _id: data.data.hospitalId, active: true }).select("_id code");
  if (!hospital?.code) return res.status(400).json({ error: { code: "INVALID_HOSPITAL", message_en: "Select an active hospital with a Hospital ID." } });
  if (await User.exists({ role: "hospital_manager", hospitalId: hospital._id, status: "active" })) {
    return res.status(409).json({ error: { code: "HOSPITAL_HAS_MANAGER", message_en: "This hospital already has an active manager." } });
  }
  const username = data.data.username.toLowerCase();
  const email = data.data.email.toLowerCase();
  const duplicate = await User.exists({ $or: [{ username }, { email }, ...(data.data.phone ? [{ phone: data.data.phone }] : [])] });
  if (duplicate) return res.status(409).json({ error: { code: "USER_EXISTS", message_en: "A user with this username, email, or phone already exists." } });
  const invite = setupToken();
  const manager = await User.create({
    name: data.data.name,
    username,
    email,
    phone: data.data.phone,
    role: "hospital_manager",
    hospitalId: hospital._id,
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12),
    passwordSetupTokenHash: invite.tokenHash,
    passwordSetupExpiresAt: invite.expiresAt,
    mfaEnabled: false,
    tokenVersion: 0
  });
  await AuditLog.create({ actor: req.user!.id, action: "create", resource: "hospital_manager", resourceId: manager._id.toString(), metadata: { actorRole: req.user!.role, hospitalId: hospital._id.toString(), outcome: "success" }, ip: req.ip });
  res.status(201).json({ manager: publicUserPayload(manager.toObject()), setupToken: invite.token, setupExpiresAt: invite.expiresAt });
} catch (error) {
  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return res.status(409).json({ error: { code: "USER_EXISTS", message_en: "A user with this username, email, or phone already exists." } });
  next(error);
} };

export const setHospitalManagerStatus: RequestHandler = async (req, res, next) => { try {
  const userId = objectIdSchema.parse(req.params.userId);
  const body = hospitalManagerStatusSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message_en: "Choose active or disabled." } });
  const manager = await User.findOne({ _id: userId, role: "hospital_manager" }).select("_id status hospitalId tokenVersion +refreshTokenHash +passwordSetupTokenHash");
  if (!manager) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Hospital manager not found." } });
  manager.status = body.data.status;
  manager.tokenVersion = (manager.tokenVersion ?? 0) + 1;
  manager.refreshTokenHash = undefined;
  if (body.data.status === "disabled") {
    manager.passwordSetupTokenHash = undefined;
    manager.passwordSetupExpiresAt = undefined;
  }
  await manager.save();
  await AuditLog.create({ actor: req.user!.id, action: body.data.status === "active" ? "activate" : "deactivate", resource: "hospital_manager", resourceId: manager._id.toString(), metadata: { actorRole: req.user!.role, hospitalId: manager.hospitalId?.toString(), outcome: "success" }, ip: req.ip });
  res.json({ manager: { id: manager._id.toString(), status: manager.status } });
} catch (e) { next(e); } };

export const resetHospitalManagerPassword: RequestHandler = async (req, res, next) => { try {
  const userId = objectIdSchema.parse(req.params.userId);
  const manager = await User.findOne({ _id: userId, role: "hospital_manager", status: "active" }).select("_id hospitalId tokenVersion +refreshTokenHash");
  if (!manager) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Active hospital manager not found." } });
  const invite = setupToken();
  manager.passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  manager.passwordSetupTokenHash = invite.tokenHash;
  manager.passwordSetupExpiresAt = invite.expiresAt;
  manager.tokenVersion = (manager.tokenVersion ?? 0) + 1;
  manager.refreshTokenHash = undefined;
  await manager.save();
  await AuditLog.create({ actor: req.user!.id, action: "password_reset", resource: "hospital_manager", resourceId: manager._id.toString(), metadata: { actorRole: req.user!.role, hospitalId: manager.hospitalId?.toString(), outcome: "success" }, ip: req.ip });
  res.json({ setupToken: invite.token, setupExpiresAt: invite.expiresAt });
} catch (e) { next(e); } };
export const auditLogs: RequestHandler = async (req, res, next) => { try { const query = auditLogQuerySchema.parse(req.query); const filter: Record<string, unknown> = {}; for (const key of ["actor", "action", "resource", "resourceId"] as const) if (query[key] !== undefined) filter[key] = query[key]; if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) }; const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(query.limit).lean(); res.json({ logs }); } catch (e) { next(e); } };
