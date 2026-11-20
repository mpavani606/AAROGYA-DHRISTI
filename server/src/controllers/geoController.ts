/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { District, GramPanchayat, Habitation, Mandal, Phc, Village } from "../models/Geo.js";
import { suppressedCount } from "../services/geoScope.js";
import { permittedDashboardMandals } from "../services/dashboardService.js";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const mandalsQuerySchema = z.object({ district: objectIdSchema.optional() }).strict();

async function mandalAccessFilter(req: Parameters<RequestHandler>[0]): Promise<Record<string, unknown>> {
  const user = req.user;
  if (!user || user.role === "system_admin") return {};
  if (user.role === "district_admin") {
    return { _id: { $in: await permittedDashboardMandals(user) ?? [] } };
  }

  const assignments = user.assignments ?? [];
  const clauses: Record<string, unknown>[] = [];
  const mandalValues = assignments.map((assignment) => assignment.mandal).filter((value): value is string => Boolean(value));
  const mandalIds = mandalValues.filter(mongoose.isValidObjectId);
  if (mandalIds.length) clauses.push({ _id: { $in: mandalIds } });
  if (mandalValues.length) clauses.push(
    { code: { $in: mandalValues } },
    { name: { $in: mandalValues } },
    { name_en: { $in: mandalValues } }
  );

  const districtValues = assignments.map((assignment) => assignment.district).filter((value): value is string => Boolean(value));
  if (districtValues.length) {
    const districtIds = districtValues.filter(mongoose.isValidObjectId);
    const districtLabels = districtValues.filter((value) => !mongoose.isValidObjectId(value));
    const districtQuery: Record<string, unknown>[] = [];
    if (districtIds.length) districtQuery.push({ _id: { $in: districtIds } });
    if (districtLabels.length) districtQuery.push(
      { code: { $in: districtLabels } },
      { name: { $in: districtLabels } },
      { name_en: { $in: districtLabels } }
    );
    if (districtQuery.length) {
      const districts = await District.find({ $or: districtQuery }).select("_id code").lean();
      const ids = districts.map((district) => district._id);
      const codes = districts.map((district) => district.code);
      if (ids.length) clauses.push({ district: { $in: ids } });
      if (codes.length) clauses.push({ districtCode: { $in: codes } });
    }
  }

  return clauses.length ? { $or: clauses } : { _id: { $in: [] } };
}

const countMap = (rows: Array<{ _id: mongoose.Types.ObjectId; count: number }>) =>
  new Map(rows.map((row) => [String(row._id), row.count]));

export const mandals: RequestHandler = async (req, res, next) => {
  try {
    const query = mandalsQuerySchema.parse(req.query);
    const accessFilter = await mandalAccessFilter(req);
    const filter = query.district ? { $and: [accessFilter, { district: query.district }] } : accessFilter;
    const rows = await Mandal.find(filter).sort({ name: 1 }).lean() as Array<{ _id: mongoose.Types.ObjectId; [key: string]: unknown }>;
    const ids = rows.map((row) => row._id);
    const [phcs, villages, habitations] = await Promise.all([
      Phc.aggregate([{ $match: { mandal: { $in: ids } } }, { $group: { _id: "$mandal", count: { $sum: 1 } } }]),
      Village.aggregate([{ $match: { mandal: { $in: ids } } }, { $group: { _id: "$mandal", count: { $sum: 1 } } }]),
      Habitation.aggregate([{ $match: { mandal: { $in: ids } } }, { $group: { _id: "$mandal", count: { $sum: 1 } } }])
    ]);
    const phcCounts = countMap(phcs);
    const villageCounts = countMap(villages);
    const habitationCounts = countMap(habitations);
    const result = rows.map((mandal) => ({
      ...mandal,
      phcCount: suppressedCount(phcCounts.get(String(mandal._id)) ?? 0),
      villageCount: suppressedCount(villageCounts.get(String(mandal._id)) ?? 0),
      habitationCount: suppressedCount(habitationCounts.get(String(mandal._id)) ?? 0)
    }));
    res.json({ mandals: result });
  } catch (e) { next(e); }
};
export const mandalDetail: RequestHandler = async (req, res, next) => {
  try {
    const mandalId = objectIdSchema.parse(req.params.mandalId);
    const accessFilter = await mandalAccessFilter(req);
    const mandal = await Mandal.findOne({ $and: [{ _id: mandalId }, accessFilter] }).lean() as (Record<string, any> & { _id: mongoose.Types.ObjectId }) | null;
    if (!mandal) return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Mandal not found." } });
    const [phcs, villageRows, habitations, habitationCounts] = await Promise.all([
      Phc.find({ mandal: mandal._id }).select("_id name name_en name_te name_hi code active").sort({ name: 1 }).lean(),
      Village.find({ mandal: mandal._id })
        .select("_id name name_en name_te name_hi code phc gramPanchayat")
        .sort({ name: 1 })
        .lean<Array<{
          _id: mongoose.Types.ObjectId;
          name: string;
          name_en?: string;
          phc?: mongoose.Types.ObjectId | null;
          gramPanchayat?: mongoose.Types.ObjectId | null;
        }>>(),
      Habitation.find({ mandal: mandal._id }).select("_id").lean(),
      Habitation.aggregate([{ $match: { mandal: mandal._id } }, { $group: { _id: "$village", count: { $sum: 1 } } }])
    ]);
    const villages = villageRows;
    const gramPanchayatIds = [...new Set(villages.flatMap((village) => village.gramPanchayat ? [String(village.gramPanchayat)] : []))];
    const gramPanchayats = await GramPanchayat.find({ _id: { $in: gramPanchayatIds }, mandal: mandal._id }).select("_id name name_en name_te").lean();
    const panchayatNames = new Map(gramPanchayats.map((panchayat) => [String(panchayat._id), panchayat.name_en ?? panchayat.name]));
    const habitationCountByVillage = countMap(habitationCounts);
    const visibleVillages = villages.map((village) => ({
      ...village,
      gramPanchayatName: village.gramPanchayat ? panchayatNames.get(String(village.gramPanchayat)) ?? null : null,
      habitationCount: suppressedCount(habitationCountByVillage.get(String(village._id)) ?? 0)
    }));
    const phcIds = new Set(phcs.map((phc) => String(phc._id)));
    const phcsWithVillages = phcs.map((phc) => ({
      ...phc,
      villages: visibleVillages.filter((village) => String(village.phc) === String(phc._id))
    }));
    const unassignedVillages = visibleVillages.filter((village) => !village.phc || !phcIds.has(String(village.phc)));
    res.json({
      mandal,
      phcs: phcsWithVillages,
      unassignedVillages,
      aggregates: {
        phcCount: suppressedCount(phcs.length),
        villageCount: suppressedCount(villages.length),
        habitationCount: suppressedCount(habitations.length)
      }
    });
  } catch (e) { next(e); }
};
export const phcVillages: RequestHandler = async (req, res, next) => {
  try {
    const phcId = objectIdSchema.parse(req.params.phcId);
    const phc = await Phc.findById(phcId).lean() as { _id: mongoose.Types.ObjectId; mandal: mongoose.Types.ObjectId } | null;
    if (!phc || !await Mandal.exists({ $and: [{ _id: phc.mandal }, await mandalAccessFilter(req)] })) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "PHC not found." } });
    }
    const villages = await Village.find({ phc: phc._id, mandal: phc.mandal }).lean();
    res.json({ phc, villages: villages.map(({ population, households, ...v }) => ({ ...v, population: suppressedCount(population), households: suppressedCount(households) })) });
  } catch (e) { next(e); }
};
export const villageCoverage: RequestHandler = async (req, res, next) => {
  try {
    const villageId = objectIdSchema.parse(req.params.villageId);
    const village = await Village.findById(villageId).lean() as { _id: mongoose.Types.ObjectId; mandal: mongoose.Types.ObjectId; population?: number; households?: number } | null;
    if (!village || !await Mandal.exists({ $and: [{ _id: village.mandal }, await mandalAccessFilter(req)] })) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message_en: "Village not found." } });
    }
    const habitations = await Habitation.find({ village: village._id, mandal: village.mandal }).lean() as any[];
    res.json({ village: { ...village, population: suppressedCount(village.population ?? 0), households: suppressedCount(village.households ?? 0) }, habitations: habitations.map((h) => ({ ...h, population: suppressedCount(h.population ?? 0), households: suppressedCount(h.households ?? 0) })) });
  } catch (e) { next(e); }
};
export const districts: RequestHandler = async (req, res, next) => {
  try {
    if (req.user?.role === "system_admin") return res.json({ districts: await District.find({}).sort({ name: 1 }).lean() });
    const mandalsInScope = await Mandal.find(await mandalAccessFilter(req)).distinct("district");
    res.json({ districts: await District.find({ _id: { $in: mandalsInScope } }).sort({ name: 1 }).lean() });
  } catch (e) { next(e); }
};
