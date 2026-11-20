import type { RequestHandler } from "express";
import { Patient } from "../models/Patient.js";
import { Habitation, Mandal, Phc, Village } from "../models/Geo.js";
import { phoneHashVariants } from "../services/patientService.js";
import { permittedDashboardMandals } from "../services/dashboardService.js";

export const patientIsAssigned = (
  patient: { createdBy?: { toString(): string }; phoneHash?: string; mandal?: string; mandalId?: { toString(): string }; phcId?: { toString(): string }; villageId?: { toString(): string }; habitationId?: { toString(): string } },
  user: NonNullable<Express.Request["user"]>
) => {
  if (user.role === "patient") return Boolean(user.phone && patient.phoneHash && phoneHashVariants(user.phone).includes(patient.phoneHash));
  if (user.role === "asha_worker") return (user.assignments ?? []).some((assignment) =>
    Boolean(assignment.village || assignment.phc)
    && (!assignment.mandal || assignment.mandal === patient.mandalId?.toString() || assignment.mandal.toLowerCase() === patient.mandal?.toLowerCase())
    && (!assignment.phc || assignment.phc === patient.phcId?.toString())
    && (!assignment.village || assignment.village === patient.villageId?.toString())
    && (!assignment.habitation || assignment.habitation === patient.habitationId?.toString()));
  return patient.createdBy?.toString() === user.id || (user.assignments ?? []).some((assignment) => Boolean(
  (assignment.mandal && (assignment.mandal === patient.mandalId?.toString() || assignment.mandal.toLowerCase() === patient.mandal?.toLowerCase())) ||
  (assignment.phc && assignment.phc === patient.phcId?.toString()) ||
  (assignment.village && assignment.village === patient.villageId?.toString()) ||
  (assignment.habitation && assignment.habitation === patient.habitationId?.toString())
  ));
};

export const patientIsWithinDistrict = async (
  patient: { mandal?: string; mandalId?: { toString(): string } },
  user: NonNullable<Express.Request["user"]>
) => {
  if (user.role !== "district_admin") return false;
  const permitted = await permittedDashboardMandals(user);
  if (!permitted?.length) return false;
  if (patient.mandalId && permitted.includes(patient.mandalId.toString())) return true;
  const mandals = await Mandal.find({ _id: { $in: permitted } }).select("name name_en name_te name_hi code").lean();
  const names = mandals.flatMap((mandal) => [mandal.name, mandal.name_en, mandal.name_te, mandal.name_hi, mandal.code].filter((value): value is string => Boolean(value))).map((value) => value.toLocaleLowerCase());
  return Boolean(patient.mandal && names.includes(patient.mandal.toLocaleLowerCase()));
};

export const mandalIsWithinDistrict = async (mandalId: string | undefined, mandalName: string, user: NonNullable<Express.Request["user"]>) => {
  if (user.role !== "district_admin") return true;
  const permitted = await permittedDashboardMandals(user);
  if (!permitted?.length) return false;
  if (mandalId) {
    if (!permitted.includes(mandalId)) return false;
    const target = await Mandal.findById(mandalId).select("name name_en name_te name_hi code").lean<{ name?: string; name_en?: string; name_te?: string; name_hi?: string; code?: string }>();
    return Boolean(target && [target.name, target.name_en, target.name_te, target.name_hi, target.code].filter(Boolean).some((value) => value!.toLocaleLowerCase() === mandalName.toLocaleLowerCase()));
  }
  const escaped = mandalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(await Mandal.exists({
    _id: { $in: permitted },
    $or: [{ name: new RegExp(`^${escaped}$`, "i") }, { name_en: new RegExp(`^${escaped}$`, "i") }, { name_te: new RegExp(`^${escaped}$`, "i") }, { name_hi: new RegExp(`^${escaped}$`, "i") }, { code: new RegExp(`^${escaped}$`, "i") }]
  }));
};

export const patientLocationIsWithinDistrict = async (
  location: { mandalId?: string; phcId?: string; villageId?: string; habitationId?: string },
  mandalName: string,
  user: NonNullable<Express.Request["user"]>
) => {
  if (user.role !== "district_admin") return true;
  if (!await mandalIsWithinDistrict(location.mandalId, mandalName, user)) return false;
  const permitted = await permittedDashboardMandals(user);
  if (!permitted?.length) return false;
  const locationChecks = [
    location.phcId ? Phc.exists({ _id: location.phcId, mandal: { $in: permitted } }) : Promise.resolve(true),
    location.villageId ? Village.exists({ _id: location.villageId, mandal: { $in: permitted } }) : Promise.resolve(true),
    location.habitationId ? Habitation.exists({ _id: location.habitationId, mandal: { $in: permitted } }) : Promise.resolve(true)
  ];
  return (await Promise.all(locationChecks)).every(Boolean);
};

export const requirePatientCareRelationship: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHORIZED", message_en: "Authentication required.", message_te: "ప్రామాణీకరణ అవసరం.", message_hi: "प्रमाणीकरण आवश्यक है।" } });
    if (req.user.role === "system_admin") return next();
    const patientId = String(req.params.id ?? req.params.patientId ?? req.body.patientId ?? "");
    const patient = await Patient.findById(patientId).select("createdBy phoneHash mandal mandalId phcId villageId habitationId");
    if (!patient) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Patient not found.", message_te: "రోగి కనుగొనబడలేదు.", message_hi: "मरीज़ नहीं मिला।" } });
    if (!patientIsAssigned(patient, req.user) && !await patientIsWithinDistrict(patient, req.user)) return res.status(403).json({ error: { code: "RELATIONSHIP_REQUIRED", message_en: "A care relationship is required.", message_te: "సంరక్షణ సంబంధం అవసరం.", message_hi: "देखभाल संबंध आवश्यक है।" } });
    next();
  } catch (error) {
    next(error);
  }
};
