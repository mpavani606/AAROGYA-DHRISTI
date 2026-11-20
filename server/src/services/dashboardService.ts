import mongoose, { type PipelineStage } from "mongoose";
import { Appointment } from "../models/Appointment.js";
import { AuditLog } from "../models/AuditLog.js";
import { Case } from "../models/Case.js";
import { CaseImage } from "../models/CaseImage.js";
import { CessationPlan } from "../models/CessationPlan.js";
import { Diagnosis } from "../models/Diagnosis.js";
import { Investigation } from "../models/Investigation.js";
import { Habitation, Mandal, Village } from "../models/Geo.js";
import { NavigatorTask } from "../models/NavigatorTask.js";
import { Notification } from "../models/Notification.js";
import { Patient } from "../models/Patient.js";
import { Referral } from "../models/Referral.js";
import { Review } from "../models/Review.js";
import { User } from "../models/User.js";

export type DashboardFilters = {
  mandalId?: string;
  phcId?: string;
  villageId?: string;
  from?: Date;
  to?: Date;
};

export const suppressedCount = (count: number): number | "<5" => count < 5 ? "<5" : count;
export const median = (input: number[]): number | null => {
  if (!input.length) return null;
  const values = [...input].sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};
export const rate = (numerator: number, denominator: number): number | null =>
  denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;

const dateMatch = (field: string, filters: DashboardFilters): Record<string, unknown> => {
  if (!filters.from && !filters.to) return {};
  return { [field]: { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) } };
};
const objectId = (id: string) => new mongoose.Types.ObjectId(id);

export async function permittedDashboardMandals(user: Express.Request["user"]): Promise<string[] | null> {
  if (user?.role === "system_admin") return null;
  const assignments = user?.assignments ?? [];
  const assignedMandals = assignments.map((a) => a.mandal).filter((value): value is string => Boolean(value));
  const assignedDistricts = assignments.map((a) => a.district).filter((value): value is string => Boolean(value));
  if (!assignedMandals.length && !assignedDistricts.length) return [];
  const clauses: Record<string, unknown>[] = [];
  if (assignedMandals.length) clauses.push({ _id: { $in: assignedMandals.filter(mongoose.isValidObjectId).map(objectId) } }, { code: { $in: assignedMandals } });
  if (assignedDistricts.length) {
    const districts = assignedDistricts.filter(mongoose.isValidObjectId).map(objectId);
    clauses.push({ district: { $in: districts } }, { districtCode: { $in: assignedDistricts } });
  }
  const rows = await Mandal.find({ $or: clauses }).select("_id name name_en code").lean();
  return rows.map((row) => String(row._id));
}

export async function buildPatientMatch(filters: DashboardFilters, permittedIds: string[] | null) {
  const clauses: Record<string, unknown>[] = [];
  if (permittedIds) {
    if (!permittedIds.length) return { _id: { $in: [] } };
    const assigned = await Mandal.find({ _id: { $in: permittedIds.map(objectId) } }).select("_id name name_en code").lean();
    clauses.push({ $or: [
      { mandalId: { $in: permittedIds.map(objectId) } },
      { mandal: { $in: assigned.flatMap((m) => [m.name, m.name_en, m.code, String(m._id)].filter(Boolean)) } }
    ] });
  }
  if (filters.mandalId) {
    const mandal = await Mandal.findOne({ _id: filters.mandalId }).select("_id name name_en code").lean<{ _id: mongoose.Types.ObjectId; name: string; name_en?: string; code: string }>();
    const legacyNames = mandal ? [mandal.name, mandal.name_en, mandal.code, mandal._id.toString()].filter(Boolean) : [];
    clauses.push({ $or: [{ mandalId: objectId(filters.mandalId) }, { mandal: { $in: legacyNames } }] });
  }
  if (filters.phcId) clauses.push({ phcId: objectId(filters.phcId) });
  if (filters.villageId) clauses.push({ villageId: objectId(filters.villageId) });
  return clauses.length ? { active: true, $and: clauses } : { active: true };
}

const prefixMatch = (match: Record<string, unknown>, prefix: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(match).map(([key, value]) => {
    if (key.startsWith("$") && Array.isArray(value)) return [key, value.map((clause) => prefixMatch(clause as Record<string, unknown>, prefix))];
    if (key.startsWith("$") && value && typeof value === "object") return [key, prefixMatch(value as Record<string, unknown>, prefix)];
    return [`${prefix}.${key}`, value];
  }));
const imageScope = (patientMatch: Record<string, unknown>, filters: DashboardFilters) => [
  { $match: dateMatch("createdAt", filters) },
  { $lookup: { from: "patients", localField: "patient", foreignField: "_id", as: "patientRow" } },
  { $unwind: "$patientRow" },
  { $match: prefixMatch(patientMatch, "patientRow") }
];
const caseScope = (patientMatch: Record<string, unknown>, filters: DashboardFilters, extraMatch: Record<string, unknown> = {}) => [
  { $match: { ...dateMatch("createdAt", filters), ...extraMatch } },
  { $lookup: { from: "patients", localField: "patient", foreignField: "_id", as: "patientRow" } },
  { $unwind: "$patientRow" },
  { $match: prefixMatch(patientMatch, "patientRow") }
];
const medianDuration = async (model: typeof Review | typeof Diagnosis, patientMatch: Record<string, unknown>, filters: DashboardFilters, startField: string) => {
  const rows = await model.aggregate([
    { $match: dateMatch("createdAt", filters) },
    { $lookup: { from: "cases", localField: "case", foreignField: "_id", as: "caseRow" } },
    { $unwind: "$caseRow" },
    { $lookup: { from: "patients", localField: "caseRow.patient", foreignField: "_id", as: "patientRow" } },
    { $unwind: "$patientRow" },
    { $match: prefixMatch(patientMatch, "patientRow") },
    { $project: { elapsed: { $divide: [{ $subtract: [`$${startField}`, "$caseRow.createdAt"] }, 3600000] } } },
    { $match: { elapsed: { $gte: 0 } } },
    { $group: { _id: null, values: { $push: "$elapsed" } } }
  ]);
  return rows[0]?.values as number[] | undefined;
};

export async function getDashboardSummary(filters: DashboardFilters, permittedIds: string[] | null) {
  const patientMatch = await buildPatientMatch(filters, permittedIds);
  const date = dateMatch("createdAt", filters);
  const [eligibleAdults, caseStats, reviewDurations, diagnosisDurations, referralStats, biopsyStats, imageStats, cessationRows, notifications, missedAppointments, screenedRows] = await Promise.all([
    Patient.countDocuments({ ...patientMatch, ageYears: { $gte: 18 } }),
    Case.aggregate([...caseScope(patientMatch, filters, { status: { $ne: "draft" } }), { $group: {
      _id: null, total: { $sum: 1 }, treatmentLinked: { $sum: { $cond: [{ $eq: ["$status", "treatment_linked"] }, 1, 0] } },
      lost: { $sum: { $cond: [{ $eq: ["$status", "lost_to_follow_up"] }, 1, 0] } }
    } }]),
    medianDuration(Review, patientMatch, filters, "signedAt"),
    medianDuration(Diagnosis, patientMatch, filters, "createdAt"),
    Referral.aggregate([
      { $match: date }, { $lookup: { from: "cases", localField: "case", foreignField: "_id", as: "caseRow" } }, { $unwind: "$caseRow" },
      { $lookup: { from: "patients", localField: "caseRow.patient", foreignField: "_id", as: "patientRow" } }, { $unwind: "$patientRow" },
      { $match: prefixMatch(patientMatch, "patientRow") },
      { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } }
    ]),
    Investigation.aggregate([
      { $match: { ...date, type: { $in: ["biopsy", "histopathology"] } } },
      { $lookup: { from: "cases", localField: "case", foreignField: "_id", as: "caseRow" } }, { $unwind: "$caseRow" },
      { $lookup: { from: "patients", localField: "caseRow.patient", foreignField: "_id", as: "patientRow" } }, { $unwind: "$patientRow" },
      { $match: prefixMatch(patientMatch, "patientRow") },
      { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $in: ["$status", ["report_received", "reviewed"]] }, 1, 0] } } } }
    ]),
    CaseImage.aggregate([...imageScope(patientMatch, filters), { $match: { qualityStatus: { $in: ["usable", "insufficient"] } } }, { $group: { _id: null, total: { $sum: 1 }, usable: { $sum: { $cond: [{ $eq: ["$qualityStatus", "usable"] }, 1, 0] } } } }]),
    CessationPlan.aggregate([
      { $match: { patient: { $in: await Patient.find(patientMatch).distinct("_id") }, ...date, status: { $ne: "cancelled" } } },
      { $group: { _id: "$patient" } },
      { $count: "count" }
    ]),
    Notification.aggregate([
      { $match: { ...date, patient: { $in: await Patient.find(patientMatch).distinct("_id") } } },
      { $group: { _id: null, total: { $sum: 1 }, success: { $sum: { $cond: [{ $in: ["$status", ["sent", "read"]] }, 1, 0] } } } }
    ]),
    Appointment.countDocuments({ ...date, patient: { $in: await Patient.find(patientMatch).distinct("_id") }, status: "missed" }),
    Case.aggregate([...caseScope(patientMatch, filters, { status: { $ne: "draft" } }), { $group: { _id: "$patient" } }, { $count: "count" }])
  ]);
  const caseTotal = caseStats[0]?.total ?? 0;
  const referral = referralStats[0] ?? { total: 0, completed: 0 };
  const biopsy = biopsyStats[0] ?? { total: 0, completed: 0 };
  const images = imageStats[0] ?? { total: 0, usable: 0 };
  const notification = notifications[0] ?? { total: 0, success: 0 };
  const cessationPatients = cessationRows[0]?.count ?? 0;
  const uniqueScreened = screenedRows[0]?.count ?? 0;
  const reviewHours = median(reviewDurations ?? []);
  const diagnosisHours = median(diagnosisDurations ?? []);
  const patientIds = await Patient.find(patientMatch).distinct("_id");
  return {
    screeningCoverage: rate(uniqueScreened, eligibleAdults),
    screeningCoverageDenominator: eligibleAdults,
    screenedAdults: uniqueScreened,
    usableImageRate: rate(images.usable, images.total),
    imagesAssessed: images.total,
    medianHoursToReview: reviewHours,
    referralCompletionRate: rate(referral.completed, referral.total),
    medianDaysToDiagnosis: diagnosisHours === null ? null : Math.round((diagnosisHours / 24) * 10) / 10,
    biopsyCompletionRate: rate(biopsy.completed, biopsy.total),
    treatmentLinkageRate: rate(caseStats[0]?.treatmentLinked ?? 0, caseTotal),
    lossToFollowUpRate: rate(caseStats[0]?.lost ?? 0, caseTotal),
    cessationUptake: rate(cessationPatients, patientIds.length),
    notificationSuccessRate: rate(notification.success, notification.total),
    missedAppointments,
    metricNotes: {
      screeningCoverage: "Uses registered active patients aged 18+ as the eligible denominator; unregistered eligible residents are not represented.",
      usableImageRate: "Only images with a recorded quality assessment are counted.",
      medianDaysToDiagnosis: "Measured from case creation to the latest diagnosis record timestamp."
    }
  };
}

export async function getHotspots(filters: DashboardFilters, permittedIds: string[] | null) {
  const patientMatch = await buildPatientMatch(filters, permittedIds);
  const rows = await Case.aggregate([
    ...caseScope(patientMatch, filters, { status: { $ne: "draft" } }),
    { $match: { "patientRow.villageId": { $exists: true, $ne: null } } },
    { $group: { _id: { village: "$patientRow.villageId", patient: "$patient" } } },
    { $group: { _id: "$_id.village", screened: { $sum: 1 } } }
  ]);
  const villageFilter: Record<string, unknown> = {};
  if (filters.mandalId) villageFilter.mandal = objectId(filters.mandalId);
  else if (permittedIds) villageFilter.mandal = { $in: permittedIds.map(objectId) };
  if (filters.phcId) villageFilter.phc = objectId(filters.phcId);
  const villages = await Village.find(villageFilter).select("_id name name_en name_te name_hi mandal phc lat lng").lean();
  const byId = new Map(villages.map((village) => [String(village._id), village]));
  const counts = new Map(rows.map((row) => [String(row._id), row.screened as number]));
  return [...byId.values()].map((village) => {
    const count = counts.get(String(village._id)) ?? 0;
    return { villageId: String(village._id), name: village.name_en ?? village.name, mandalId: String(village.mandal ?? ""), phcId: String(village.phc ?? ""), lat: village.lat ?? null, lng: village.lng ?? null, screened: suppressedCount(count) };
  });
}

export async function getVillageCoverage(filters: DashboardFilters, permittedIds: string[] | null) {
  const habitationMatch: Record<string, unknown> = {};
  if (filters.mandalId) habitationMatch.mandal = objectId(filters.mandalId);
  else if (permittedIds) habitationMatch.mandal = { $in: permittedIds.map(objectId) };
  const pipeline: PipelineStage[] = [
    { $match: habitationMatch },
    { $lookup: { from: "villages", localField: "village", foreignField: "_id", as: "villageRow" } },
    { $unwind: "$villageRow" }
  ];
  if (filters.phcId) pipeline.push({ $match: { "villageRow.phc": objectId(filters.phcId) } });
  if (filters.villageId) pipeline.push({ $match: { village: objectId(filters.villageId) } });
  pipeline.push(
    { $group: {
      _id: "$village",
      totalHabitations: { $sum: 1 },
      screenedHabitations: { $sum: { $cond: [{ $gt: ["$coverage", 0] }, 1, 0] } },
      pendingHabitations: { $sum: { $cond: [{ $eq: ["$coverage", 0] }, 1, 0] } },
      averageCoverage: { $avg: "$coverage" }
    } },
    { $lookup: { from: "villages", localField: "_id", foreignField: "_id", as: "villageRow" } },
    { $unwind: "$villageRow" },
    { $project: { _id: 0, villageId: "$_id", name: { $ifNull: ["$villageRow.name_en", "$villageRow.name"] }, totalHabitations: 1, screenedHabitations: 1, pendingHabitations: 1, averageCoverage: { $round: ["$averageCoverage", 1] } } }
  );
  const rows = await Habitation.aggregate(pipeline);
  return rows.map((row) => ({
    ...row,
    totalHabitations: suppressedCount(row.totalHabitations),
    screenedHabitations: suppressedCount(row.screenedHabitations),
    pendingHabitations: suppressedCount(row.pendingHabitations)
  }));
}

export async function getDataQuality(filters: DashboardFilters, permittedIds: string[] | null) {
  const patientMatch = await buildPatientMatch(filters, permittedIds);
  const [missingVillage, impossibleAges, duplicatePhones, repeatedPoorImages, pendingSyncTooLong] = await Promise.all([
    Patient.countDocuments({ ...patientMatch, $or: [{ villageId: { $exists: false } }, { villageId: null }] }),
    Patient.countDocuments({ ...patientMatch, $or: [{ ageYears: { $lt: 0 } }, { ageYears: { $gt: 120 } }] }),
    Patient.aggregate([{ $match: { ...patientMatch, phoneHash: { $exists: true, $ne: null } } }, { $group: { _id: "$phoneHash", patients: { $addToSet: "$_id" } } }, { $match: { $expr: { $gt: [{ $size: "$patients" }, 1] } } }, { $count: "count" }]),
    CaseImage.aggregate([...imageScope(patientMatch, filters), { $match: { qualityStatus: "insufficient" } }, { $group: { _id: "$patient", count: { $sum: 1 } } }, { $match: { count: { $gte: 2 } } }, { $count: "count" }]),
    Promise.resolve(null)
  ]);
  return {
    missingVillage,
    duplicatePhoneGroups: duplicatePhones[0]?.count ?? 0,
    impossibleAges,
    patientsWithRepeatedPoorImages: repeatedPoorImages[0]?.count ?? 0,
    pendingSyncTooLong,
    pendingSyncNote: "The server stores completed sync operations only; queued offline items are not visible server-side."
  };
}

export async function getAshaActivity(ashaId: string, filters: DashboardFilters, permittedIds: string[] | null) {
  const user = await User.findOne({ _id: ashaId }).select("_id role subRole assignments").lean<{ role: string; subRole?: string; assignments?: Array<{ mandal?: string; district?: string }> }>();
  if (!user || user.role !== "employee" || user.subRole !== "asha") return null;
  if (permittedIds) {
    const assignments = user.assignments ?? [];
    const assignedMandals = assignments.map((assignment) => assignment.mandal).filter((value): value is string => Boolean(value));
    const assignedDistricts = assignments.map((assignment) => assignment.district).filter((value): value is string => Boolean(value));
    const clauses: Record<string, unknown>[] = [];
    if (assignedMandals.length) clauses.push(
      { _id: { $in: assignedMandals.filter(mongoose.isValidObjectId).map(objectId) } },
      { code: { $in: assignedMandals } }
    );
    if (assignedDistricts.length) clauses.push(
      { district: { $in: assignedDistricts.filter(mongoose.isValidObjectId).map(objectId) } },
      { districtCode: { $in: assignedDistricts } }
    );
    const ashaMandals = clauses.length ? await Mandal.find({ $or: clauses }).distinct("_id") : [];
    if (!ashaMandals.some((mandalId) => permittedIds.includes(String(mandalId)))) return null;
  }
  const patientMatch = await buildPatientMatch(filters, permittedIds);
  const ashaCaseScope = caseScope(patientMatch, filters, { createdBy: objectId(ashaId), status: { $ne: "draft" } });
  const cases = await Case.aggregate([...ashaCaseScope, { $group: { _id: null, screenings: { $sum: 1 } } }]);
  const ashaCases = await Case.aggregate([...ashaCaseScope, { $project: { _id: 1, patient: 1 } }]);
  const assignedCaseIds = ashaCases.map((item) => item._id);
  const ashaPatientIds = ashaCases.map((item) => item.patient);
  const [images, dueTasks] = await Promise.all([
    CaseImage.aggregate([{ $match: { case: { $in: assignedCaseIds }, ...dateMatch("createdAt", filters), qualityStatus: { $in: ["usable", "insufficient"] } } }, { $group: { _id: null, total: { $sum: 1 }, usable: { $sum: { $cond: [{ $eq: ["$qualityStatus", "usable"] }, 1, 0] } } } }]),
    NavigatorTask.countDocuments({ patient: { $in: ashaPatientIds }, status: { $in: ["open", "in_progress"] }, dueAt: { $lte: new Date() } })
  ]);
  return {
    screenings: cases[0]?.screenings ?? 0,
    usableImagePercent: rate(images[0]?.usable ?? 0, images[0]?.total ?? 0),
    pendingSyncs: null,
    followUpsDue: dueTasks
  };
}

export function dashboardCsv(summary: Record<string, unknown>): string {
  const rows = Object.entries(summary).filter(([, value]) => typeof value === "number" || value === null);
  return ["metric,value", ...rows.map(([key, value]) => `${key},${value === null ? "" : value}`)].join("\r\n");
}

export async function auditDashboardExport(actor: string, ip: string | undefined, filters: DashboardFilters) {
  await AuditLog.create({ actor, action: "export", resource: "DistrictDashboardAggregate", ip, metadata: { filters: { ...filters, from: filters.from?.toISOString(), to: filters.to?.toISOString() }, aggregateOnly: true } });
}
