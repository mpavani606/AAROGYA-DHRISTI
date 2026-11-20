import mongoose, { type PipelineStage } from "mongoose";
import { Appointment } from "../models/Appointment.js";
import { Case } from "../models/Case.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { Hospital, Mandal, Phc, Village } from "../models/Geo.js";
import { FollowUp } from "../models/FollowUp.js";
import { Patient } from "../models/Patient.js";
import { Referral } from "../models/Referral.js";
import { User } from "../models/User.js";
import { buildPatientMatch, permittedDashboardMandals } from "./dashboardService.js";

export type AnalyticsFilters = {
  from?: Date;
  to?: Date;
  districtId?: string;
  mandalId?: string;
  phcId?: string;
  villageId?: string;
  hospitalId?: string;
  screeningStatus?: string;
  referralStatus?: string;
  followUpStatus?: string;
  appointmentStatus?: string;
  page: number;
  pageSize: number;
};
type AnalyticsUser = NonNullable<Express.Request["user"]>;
type Scope = {
  role: string;
  patientMatch: Record<string, unknown>;
  hospitalId?: mongoose.Types.ObjectId;
  hospitalIds?: mongoose.Types.ObjectId[];
  mandalIds?: mongoose.Types.ObjectId[];
  doctorId?: mongoose.Types.ObjectId;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const emptyStats = (rows: Array<{ _id: string; count: number }>) =>
  Object.fromEntries(rows.map((row) => [row._id, row.count])) as Record<string, number>;
const dateMatch = (field: string, filters: AnalyticsFilters) => filters.from || filters.to
  ? { [field]: { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) } }
  : {};

function prefixMatch(match: Record<string, unknown>, prefix: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(match).map(([key, value]) => {
    if (key.startsWith("$") && Array.isArray(value)) return [key, value.map((item) => prefixMatch(item as Record<string, unknown>, prefix))];
    return [key.startsWith("$") ? key : `${prefix}.${key}`, value];
  }));
}

function assignmentPatientMatch(user: AnalyticsUser) {
  const clauses: Record<string, unknown>[] = [{ createdBy: oid(user.id) }];
  for (const assignment of user.assignments ?? []) {
    if (assignment.mandal) {
      if (mongoose.isValidObjectId(assignment.mandal)) clauses.push({ mandalId: oid(assignment.mandal) });
      clauses.push({ mandal: assignment.mandal });
    }
    if (assignment.phc && mongoose.isValidObjectId(assignment.phc)) clauses.push({ phcId: oid(assignment.phc) });
    if (assignment.habitation && mongoose.isValidObjectId(assignment.habitation)) clauses.push({ habitationId: oid(assignment.habitation) });
  }
  return { active: true, $or: clauses };
}

export async function resolveAnalyticsScope(user: AnalyticsUser, filters: AnalyticsFilters): Promise<Scope> {
  if (user.role === "system_admin") {
    let mandalIds: mongoose.Types.ObjectId[] | undefined;
    if (filters.districtId) {
      mandalIds = (await Mandal.find({ district: oid(filters.districtId) }).distinct("_id")).map((id) => new mongoose.Types.ObjectId(id));
    }
    if (filters.mandalId) {
      if (filters.districtId && !mandalIds?.some((id) => id.toString() === filters.mandalId)) {
        throw Object.assign(new Error("Mandal does not belong to the selected district."), { status: 400, code: "INVALID_ANALYTICS_FILTER" });
      }
      mandalIds = [oid(filters.mandalId)];
    }
    const patientMatch: Record<string, unknown> = await buildPatientMatch(
      {
        ...(filters.mandalId ? { mandalId: filters.mandalId } : {}),
        ...(filters.phcId ? { phcId: filters.phcId } : {}),
        ...(filters.villageId ? { villageId: filters.villageId } : {})
      },
      mandalIds?.map(String) ?? null
    );
    if (filters.hospitalId && (filters.districtId || filters.mandalId)) {
      const hospital = await Hospital.findById(filters.hospitalId).select("mandal mandalId");
      const hospitalMandal = (hospital?.mandalId ?? hospital?.mandal)?.toString();
      if (!hospitalMandal || !mandalIds?.some((id) => id.toString() === hospitalMandal)) {
        throw Object.assign(new Error("Hospital does not belong to the selected geographic filter."), { status: 400, code: "INVALID_ANALYTICS_FILTER" });
      }
    }
    const hospitalIds = filters.hospitalId
      ? [oid(filters.hospitalId)]
      : mandalIds !== undefined
        ? (await Hospital.find({ $or: [{ mandal: { $in: mandalIds } }, { mandalId: { $in: mandalIds } }] }).distinct("_id")).map((id) => oid(id.toString()))
        : undefined;
    return {
      role: user.role,
      patientMatch,
      ...(filters.hospitalId ? { hospitalId: oid(filters.hospitalId) } : {}),
      ...(hospitalIds ? { hospitalIds } : {}),
      ...(mandalIds ? { mandalIds } : {})
    };
  }

  if (user.role === "district_admin") {
    if (filters.hospitalId) {
      const hospital = await Hospital.findById(filters.hospitalId).select("mandal mandalId");
      if (!hospital) throw Object.assign(new Error("Hospital is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
      const mandal = (hospital.mandalId ?? hospital.mandal)?.toString();
      const permitted = await permittedDashboardMandals(user);
      if (!mandal || !permitted?.includes(mandal)) throw Object.assign(new Error("Hospital is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    }
    const permitted = await permittedDashboardMandals(user) ?? [];
    let mandalIds = permitted.map(oid);
    if (filters.districtId) {
      const districtMandals = (await Mandal.find({ district: oid(filters.districtId) }).distinct("_id")).map((id) => id.toString());
      const intersection = districtMandals.filter((id) => permitted.includes(id));
      if (!intersection.length) throw Object.assign(new Error("District is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
      mandalIds = intersection.map(oid);
    }
    if (filters.mandalId) {
      if (!permitted.includes(filters.mandalId)) throw Object.assign(new Error("Mandal is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
      mandalIds = [oid(filters.mandalId)];
    }
    if (filters.phcId && !await Phc.exists({ _id: filters.phcId, mandal: { $in: mandalIds } })) {
      throw Object.assign(new Error("PHC is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    }
    if (filters.villageId && !await Village.exists({ _id: filters.villageId, mandal: { $in: mandalIds } })) {
      throw Object.assign(new Error("Village is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    }
    if (filters.hospitalId) {
      const hospital = await Hospital.findById(filters.hospitalId).select("mandal mandalId");
      const hospitalMandal = (hospital?.mandalId ?? hospital?.mandal)?.toString();
      if (!hospitalMandal || !mandalIds.some((id) => id.toString() === hospitalMandal)) {
        throw Object.assign(new Error("Hospital is outside the selected geographic scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
      }
    }
    const patientMatch = await buildPatientMatch({
      ...(filters.mandalId ? { mandalId: filters.mandalId } : {}),
      ...(filters.phcId ? { phcId: filters.phcId } : {}),
      ...(filters.villageId ? { villageId: filters.villageId } : {})
    }, mandalIds.map(String));
    const hospitalIds = filters.hospitalId
      ? [oid(filters.hospitalId)]
      : (await Hospital.find({ $or: [{ mandal: { $in: mandalIds } }, { mandalId: { $in: mandalIds } }] }).distinct("_id")).map((id) => oid(id.toString()));
    return {
      role: user.role,
      patientMatch: filters.hospitalId
        ? { ...patientMatch, _id: { $in: await Appointment.distinct("patient", { hospital: oid(filters.hospitalId), patient: { $exists: true }, status: { $ne: "cancelled" } }) } }
        : patientMatch,
      ...(filters.hospitalId ? { hospitalId: oid(filters.hospitalId) } : {}),
      hospitalIds,
      mandalIds
    };
  }

  if (user.role === "hospital_manager") {
    if (!user.hospitalId || (filters.hospitalId && filters.hospitalId !== user.hospitalId)) {
      throw Object.assign(new Error("Hospital is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    }
    const hospitalId = oid(user.hospitalId);
    const hospital = await Hospital.findOne({ _id: hospitalId, active: true }).select("mandal mandalId");
    if (!hospital) throw Object.assign(new Error("The assigned hospital is not active."), { status: 403, code: "HOSPITAL_INACTIVE" });
    const assignedMandal = (hospital.mandalId ?? hospital.mandal)?.toString();
    if (filters.mandalId && filters.mandalId !== assignedMandal) throw Object.assign(new Error("Mandal is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    if (filters.districtId && (!assignedMandal || !await Mandal.exists({ _id: assignedMandal, district: oid(filters.districtId) }))) {
      throw Object.assign(new Error("District is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    }
    if (filters.phcId && (!assignedMandal || !await Phc.exists({ _id: filters.phcId, mandal: assignedMandal }))) {
      throw Object.assign(new Error("PHC is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    }
    if (filters.villageId && (!assignedMandal || !await Village.exists({ _id: filters.villageId, mandal: assignedMandal }))) {
      throw Object.assign(new Error("Village is outside your analytics scope."), { status: 403, code: "ANALYTICS_SCOPE_FORBIDDEN" });
    }
    const patientMatch = await buildPatientMatch({
      ...(assignedMandal ? { mandalId: assignedMandal } : {}),
      ...(filters.phcId ? { phcId: filters.phcId } : {}),
      ...(filters.villageId ? { villageId: filters.villageId } : {})
    }, assignedMandal ? [assignedMandal] : null);
    return {
      role: user.role,
      patientMatch,
      hospitalId,
      ...(assignedMandal ? { mandalIds: [oid(assignedMandal)] } : {})
    };
  }

  if (user.role === "doctor") {
    if (filters.districtId || filters.mandalId || filters.phcId || filters.villageId || filters.hospitalId) {
      throw Object.assign(new Error("Geographic and hospital filters are unavailable for doctor analytics."), { status: 400, code: "ANALYTICS_FILTER_NOT_ALLOWED" });
    }
    return { role: user.role, patientMatch: assignmentPatientMatch(user), doctorId: oid(user.id) };
  }
  throw Object.assign(new Error("Analytics are not available for this role."), { status: 403, code: "FORBIDDEN" });
}

function caseScopeStages(scope: Scope, caseId = "$_id", patientId = "$patient"): PipelineStage[] {
  if (scope.role === "system_admin") {
    const stages: PipelineStage[] = [];
    if (scope.mandalIds && scope.mandalIds.length === 0) stages.push({ $match: { _id: { $in: [] } } });
    if (scope.mandalIds?.length) {
      stages.push(
        { $lookup: { from: "patients", localField: patientId.slice(1), foreignField: "_id", as: "patientRow" } },
        { $unwind: "$patientRow" },
        { $match: prefixMatch(scope.patientMatch, "patientRow") }
      );
    }
    if (scope.hospitalId) {
      stages.push(
        { $lookup: { from: "appointments", let: { caseRef: caseId }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$case", "$$caseRef"] }, { $eq: ["$hospital", scope.hospitalId] }, { $ne: ["$status", "cancelled"] }] } } }, { $limit: 1 }], as: "scopeAppointments" } },
        { $match: { scopeAppointments: { $ne: [] } } }
      );
    }
    return stages;
  }
  if (scope.role === "district_admin") return [
    { $lookup: { from: "patients", localField: patientId.slice(1), foreignField: "_id", as: "patientRow" } },
    { $unwind: "$patientRow" },
    { $match: prefixMatch(scope.patientMatch, "patientRow") },
    ...(scope.hospitalId ? [
      { $lookup: { from: "appointments", let: { caseRef: caseId }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$case", "$$caseRef"] }, { $eq: ["$hospital", scope.hospitalId] }, { $ne: ["$status", "cancelled"] }] } } }, { $limit: 1 }], as: "scopeAppointments" } },
      { $match: { scopeAppointments: { $ne: [] } } }
    ] : [])
  ];
  if (scope.role === "hospital_manager") return [
    { $lookup: { from: "appointments", let: { caseRef: caseId }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$case", "$$caseRef"] }, { $eq: ["$hospital", scope.hospitalId] }, { $ne: ["$status", "cancelled"] }] } } }, { $limit: 1 }], as: "scopeAppointments" } },
    { $match: { scopeAppointments: { $ne: [] } } }
  ];
  return [
    { $lookup: { from: "patients", localField: patientId.slice(1), foreignField: "_id", as: "patientRow" } },
    { $unwind: "$patientRow" },
    { $lookup: { from: "appointments", let: { caseRef: caseId, patientRef: patientId }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$clinician", scope.doctorId] }, { $eq: ["$patient", "$$patientRef"] }, { $ne: ["$status", "cancelled"] }, { $or: [{ $eq: ["$case", "$$caseRef"] }, { $eq: [{ $type: "$case" }, "missing"] }] }] } } }, { $limit: 1 }], as: "scopeAppointments" } },
    { $match: { $or: [prefixMatch(scope.patientMatch, "patientRow"), { scopeAppointments: { $ne: [] } }] } }
  ];
}

function relatedScopeStages(scope: Scope): PipelineStage[] {
  return [
    { $lookup: { from: "cases", localField: "case", foreignField: "_id", as: "caseRow" } },
    { $unwind: "$caseRow" },
    ...caseScopeStages(scope, "$caseRow._id", "$caseRow.patient")
  ];
}

function statusPipeline(model: typeof Case | typeof Referral | typeof FollowUp, scope: Scope, filters: AnalyticsFilters, kind: "case" | "referral" | "followUp") {
  const dateField = kind === "case" ? "createdAt" : "createdAt";
  const statusField = kind === "case" ? filters.screeningStatus : kind === "referral" ? filters.referralStatus : filters.followUpStatus;
  const match = { ...dateMatch(dateField, filters), ...(statusField ? { status: statusField } : {}) };
  return model.aggregate([
    ...(kind === "case" ? caseScopeStages(scope) : relatedScopeStages(scope)),
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
}

function appointmentScopeStages(scope: Scope): PipelineStage[] {
  if (scope.role === "hospital_manager") return [{ $match: { hospital: scope.hospitalId } }];
  if (scope.role === "doctor") return [{ $match: { clinician: scope.doctorId } }];
  if (scope.role === "district_admin" || (scope.role === "system_admin" && (scope.mandalIds !== undefined || scope.hospitalId))) return [
    ...(scope.role === "system_admin" && scope.mandalIds?.length === 0 ? [{ $match: { _id: { $in: [] } } }] : []),
    ...(scope.hospitalId ? [{ $match: { hospital: scope.hospitalId } }] : []),
    { $lookup: { from: "patients", localField: "patient", foreignField: "_id", as: "patientRow" } },
    { $unwind: "$patientRow" },
    { $match: prefixMatch(scope.patientMatch, "patientRow") }
  ];
  return [];
}

function appointmentPipeline(scope: Scope, filters: AnalyticsFilters) {
  return Appointment.aggregate([
    ...appointmentScopeStages(scope),
    { $match: { ...dateMatch("startAt", filters), ...(filters.appointmentStatus ? { status: filters.appointmentStatus } : {}), ...(scope.role === "system_admin" && scope.hospitalId ? { hospital: scope.hospitalId } : {}) } },
    { $group: { _id: "$status", count: { $sum: 1 }, upcoming: { $sum: { $cond: [{ $gt: ["$startAt", new Date()] }, 1, 0] } } } }
  ]);
}

async function monthlyTrend(scope: Scope, filters: AnalyticsFilters) {
  const pipeline: PipelineStage[] = [
    ...caseScopeStages(scope),
    { $match: { ...dateMatch("createdAt", filters), ...(filters.screeningStatus ? { status: filters.screeningStatus } : { status: { $ne: "draft" } }) } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
        screenings: { $sum: 1 },
        reviews: { $sum: { $cond: [{ $eq: ["$status", "clinician_reviewed"] }, 1, 0] } },
        referrals: { $sum: { $cond: [{ $in: ["$status", ["urgent_referral", "routine_follow_up", "specialist_review"]] }, 1, 0] } }
      }
    },
    { $sort: { _id: 1 } },
    { $facet: { metadata: [{ $count: "total" }], items: [{ $skip: (filters.page - 1) * filters.pageSize }, { $limit: filters.pageSize }] } }
  ];
  const [result] = await Case.aggregate(pipeline);
  return { items: result?.items ?? [], total: result?.metadata?.[0]?.total ?? 0 };
}

async function adminOverview(scope: Scope, filters: AnalyticsFilters) {
  const hospitalFilter: Record<string, unknown> = scope.hospitalId
    ? { _id: scope.hospitalId, active: true }
    : scope.hospitalIds
      ? { _id: { $in: scope.hospitalIds }, active: true }
      : { active: true };
  if (scope.role === "system_admin" && filters.hospitalId) hospitalFilter._id = scope.hospitalId;
  const scopedDoctorIds = scope.hospitalId || scope.hospitalIds
    ? await DoctorProfile.distinct("user", scope.hospitalId ? { hospital: scope.hospitalId } : { hospital: { $in: scope.hospitalIds } })
    : undefined;
  const doctorQuery = {
    role: "doctor",
    ...(scope.hospitalId ? { _id: { $in: scopedDoctorIds ?? [] } }
      : scope.role === "district_admin"
        ? { $or: [
          ...(scope.mandalIds?.length ? [{ assignments: { $elemMatch: { mandal: { $in: scope.mandalIds.map(String) } } } }] : []),
          ...(scopedDoctorIds?.length ? [{ _id: { $in: scopedDoctorIds } }] : [])
        ] }
        : scopedDoctorIds ? { _id: { $in: scopedDoctorIds } } : {})
  };
  const profileScope = scope.hospitalId
    ? { hospital: scope.hospitalId }
    : scope.hospitalIds
      ? { hospital: { $in: scope.hospitalIds } }
      : scope.role === "district_admin"
        ? { user: { $in: await User.find(doctorQuery).distinct("_id") } }
        : {};
  const patientCountQuery = scope.role === "doctor" ? Promise.resolve(null) : scope.hospitalId
    ? Appointment.aggregate([
      { $match: { hospital: scope.hospitalId, status: { $ne: "cancelled" }, ...dateMatch("startAt", filters) } },
      { $group: { _id: "$patient" } },
      { $lookup: { from: "patients", localField: "_id", foreignField: "_id", as: "patientRow" } },
      { $unwind: "$patientRow" },
      { $match: prefixMatch(scope.patientMatch, "patientRow") },
      { $count: "total" }
    ]).then((rows) => rows[0]?.total ?? 0)
    : Patient.countDocuments({ ...scope.patientMatch, ...dateMatch("createdAt", filters) });
  const [patientCount, totalDoctors, activeDoctors, verifiedDoctors, pendingDoctors, activeHospitals, doctorProfiles, mandalRows] = await Promise.all([
    patientCountQuery,
    scope.role === "doctor" ? Promise.resolve(0) : User.countDocuments(doctorQuery),
    scope.role === "doctor" ? Promise.resolve(0) : User.countDocuments({ ...doctorQuery, status: "active" }),
    scope.role === "doctor" ? Promise.resolve(0) : DoctorProfile.countDocuments({ verificationStatus: "verified", ...profileScope }),
    scope.role === "doctor" ? Promise.resolve(0) : DoctorProfile.countDocuments({ verificationStatus: "pending", ...profileScope }),
    scope.role === "doctor" ? Promise.resolve(0) : Hospital.countDocuments(hospitalFilter),
    scope.role === "hospital_manager" ? DoctorProfile.aggregate([
      { $match: { hospital: scope.hospitalId } },
      { $project: { slots: { $size: { $filter: { input: "$availability", as: "slot", cond: { $gt: ["$$slot.end", new Date()] } } } } } },
      { $group: { _id: null, doctors: { $sum: 1 }, availableSlots: { $sum: "$slots" } } }
    ]) : Promise.resolve([]),
    scope.role === "district_admin" || (scope.role === "system_admin" && (filters.districtId || filters.mandalId))
      ? Mandal.aggregate([
        { $match: { ...(scope.mandalIds?.length ? { _id: { $in: scope.mandalIds } } : {}), ...(filters.districtId ? { district: oid(filters.districtId) } : {}), ...(filters.mandalId ? { _id: oid(filters.mandalId) } : {}) } },
        { $project: { _id: 0, name: { $ifNull: ["$name_en", "$name"] }, mandalId: "$_id" } }
      ])
      : Promise.resolve([])
  ]);
  return {
    registeredPatients: patientCount,
    doctors: { total: totalDoctors, active: activeDoctors, verified: verifiedDoctors, pendingVerification: pendingDoctors },
    activeHospitals,
    hospitalOperations: doctorProfiles[0] ?? { doctors: totalDoctors, availableSlots: 0 },
    geographicUnits: mandalRows
  };
}

export async function getAnalyticsOverview(user: AnalyticsUser, filters: AnalyticsFilters) {
  const scope = await resolveAnalyticsScope(user, filters);
  const [caseRows, referralRows, followUpRows, appointmentRows, overview, trend] = await Promise.all([
    statusPipeline(Case, scope, filters, "case"),
    statusPipeline(Referral, scope, filters, "referral"),
    statusPipeline(FollowUp, scope, filters, "followUp"),
    appointmentPipeline(scope, filters),
    adminOverview(scope, filters),
    monthlyTrend(scope, filters)
  ]);
  const screeningCounts = emptyStats(caseRows);
  const referralCounts = emptyStats(referralRows);
  const followUpCounts = emptyStats(followUpRows);
  const appointmentCounts = emptyStats(appointmentRows);
  return {
    scope: user.role,
    filters: {
      from: filters.from?.toISOString() ?? null,
      to: filters.to?.toISOString() ?? null,
      page: filters.page,
      pageSize: filters.pageSize
    },
    totals: {
      ...overview,
      screenings: { total: Object.values(screeningCounts).reduce((sum, value) => sum + value, 0), byStatus: screeningCounts, pendingReview: screeningCounts.in_review ?? 0, completedReview: screeningCounts.clinician_reviewed ?? 0 },
      referrals: { total: Object.values(referralCounts).reduce((sum, value) => sum + value, 0), byStatus: referralCounts, completed: referralCounts.completed ?? 0 },
      followUps: { total: Object.values(followUpCounts).reduce((sum, value) => sum + value, 0), byStatus: followUpCounts, completed: followUpCounts.completed ?? 0 },
      appointments: { total: Object.values(appointmentCounts).reduce((sum, value) => sum + value, 0), byStatus: appointmentCounts, upcoming: appointmentRows.reduce((sum, row) => sum + (row.upcoming ?? 0), 0) }
    },
    monthlyTrend: trend.items,
    pagination: { page: filters.page, pageSize: filters.pageSize, total: trend.total, totalPages: Math.ceil(trend.total / filters.pageSize) }
  };
}
