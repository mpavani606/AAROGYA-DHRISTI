import type { RequestHandler } from "express";
import { z } from "zod";
import { DirectoryDoctor, FacilityDirectory } from "../models/FacilityDirectory.js";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  mandal: z.string().trim().max(100).optional(),
  type: z.enum(["PHC", "CHC", "Area Hospital", "District Hospital"]).optional(),
  specialization: z.string().trim().max(120).optional(),
  facilityPage: z.coerce.number().int().min(1).default(1),
  doctorPage: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10)
}).strict();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regexFields = (regex: RegExp, fields: string[]) => fields.map((field) => ({ [field]: regex }));

export const getFacilityDirectoryDetail: RequestHandler = async (req, res, next) => {
  try {
    const facilityId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.facilityId);
    const facility = await FacilityDirectory.findById(facilityId).lean();
    if (!facility) return res.status(404).json({ error: { code: "FACILITY_NOT_FOUND", message_en: "Directory facility not found." } });
    const doctors = await DirectoryDoctor.find({ hospitalId: facilityId }).sort({ name: 1 }).lean();
    res.json({ facility: { ...facility, doctors } });
  } catch (error) { next(error); }
};

export const searchFacilityDirectory: RequestHandler = async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const facilityBase: Record<string, unknown>[] = [];
    const doctorBase: Record<string, unknown>[] = [];
    if (query.district) {
      const district = new RegExp(`^${escapeRegex(query.district)}$`, "i");
      facilityBase.push({ district });
      doctorBase.push({ district });
    }
    if (query.mandal) {
      const mandal = new RegExp(`^${escapeRegex(query.mandal)}$`, "i");
      facilityBase.push({ mandal });
      doctorBase.push({ mandal });
    }
    if (query.type) facilityBase.push({ facilityType: query.type });
    if (query.specialization) {
      doctorBase.push(query.specialization === "Not Available"
        ? { $or: [{ specialization: null }, { specialization: "" }] }
        : { specialization: new RegExp(`^${escapeRegex(query.specialization)}$`, "i") });
    }

    const facilitySearchFields = ["name", "hospitalCode", "district", "mandal", "address", "contactNumber", "email"];
    const doctorSearchFields = ["name", "role", "specialization", "registrationNumber", "hprId", "mobile", "email", "district", "mandal"];
    let matchingDoctorHospitalIds: unknown[] = [];
    let matchingFacilityIds: unknown[] = [];

    if (query.q) {
      const searchRegex = new RegExp(escapeRegex(query.q), "i");
      matchingDoctorHospitalIds = await DirectoryDoctor.distinct("hospitalId", {
        $and: [...doctorBase, { $or: regexFields(searchRegex, doctorSearchFields) }]
      });
      matchingFacilityIds = await FacilityDirectory.distinct("_id", {
        $and: [...facilityBase, { $or: regexFields(searchRegex, facilitySearchFields) }]
      });
    }

    const facilityConditions = [...facilityBase];
    if (query.q) {
      facilityConditions.push({
        $or: [
          { $or: regexFields(new RegExp(escapeRegex(query.q), "i"), facilitySearchFields) },
          ...(matchingDoctorHospitalIds.length ? [{ _id: { $in: matchingDoctorHospitalIds } }] : [])
        ]
      });
    }
    if (query.specialization && matchingDoctorHospitalIds.length === 0) {
      const specializedFacilityIds = await DirectoryDoctor.distinct("hospitalId", { $and: doctorBase });
      facilityConditions.push({ _id: { $in: specializedFacilityIds } });
    } else if (query.specialization) {
      facilityConditions.push({ _id: { $in: matchingDoctorHospitalIds } });
    }
    const facilityFilter = facilityConditions.length ? { $and: facilityConditions } : {};

    const doctorConditions = [...doctorBase];
    if (query.q) {
      doctorConditions.push({
        $or: [
          { $or: regexFields(new RegExp(escapeRegex(query.q), "i"), doctorSearchFields) },
          ...(matchingFacilityIds.length ? [{ hospitalId: { $in: matchingFacilityIds } }] : [])
        ]
      });
    }
    if (query.type) {
      const typedFacilityIds = await FacilityDirectory.distinct("_id", {
        $and: [...facilityBase, { facilityType: query.type }]
      });
      doctorConditions.push({ hospitalId: { $in: typedFacilityIds } });
    }
    if (query.specialization && !query.q) {
      doctorConditions.push(query.specialization === "Not Available"
        ? { $or: [{ specialization: null }, { specialization: "" }] }
        : { specialization: new RegExp(`^${escapeRegex(query.specialization)}$`, "i") });
    }
    const doctorFilter = doctorConditions.length ? { $and: doctorConditions } : {};

    const [
      totalFacilities,
      facilityRecords,
      totalDoctors,
      doctorRecords,
      allFacilityCount,
      allDoctorCount,
      districts,
      mandals,
      facilityTypes,
      specialties
    ] = await Promise.all([
      FacilityDirectory.countDocuments(facilityFilter),
      FacilityDirectory.find(facilityFilter)
        .sort({ facilityType: 1, name: 1, _id: 1 })
        .skip((query.facilityPage - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      DirectoryDoctor.countDocuments(doctorFilter),
      DirectoryDoctor.find(doctorFilter)
        .sort({ name: 1, _id: 1 })
        .skip((query.doctorPage - 1) * query.limit)
        .limit(query.limit)
        .populate("hospitalId")
        .lean(),
      FacilityDirectory.countDocuments(),
      DirectoryDoctor.countDocuments(),
      FacilityDirectory.distinct("district"),
      FacilityDirectory.distinct("mandal"),
      FacilityDirectory.distinct("facilityType"),
      DirectoryDoctor.distinct("specialization")
    ]);

    const facilityIds = facilityRecords.map((facility) => facility._id);
    const associatedDoctors = facilityIds.length
      ? await DirectoryDoctor.find({ hospitalId: { $in: facilityIds } }).sort({ name: 1 }).lean()
      : [];
    const doctorsByFacility = new Map<string, typeof associatedDoctors>();
    for (const doctor of associatedDoctors) {
      const key = doctor.hospitalId.toString();
      const items = doctorsByFacility.get(key) ?? [];
      items.push(doctor);
      doctorsByFacility.set(key, items);
    }

    res.json({
      facilities: facilityRecords.map((facility) => ({
        ...facility,
        doctors: doctorsByFacility.get(String(facility._id)) ?? []
      })),
      doctors: doctorRecords,
      pagination: {
        facilities: {
          page: query.facilityPage,
          pageSize: query.limit,
          totalRecords: totalFacilities,
          totalPages: Math.ceil(totalFacilities / query.limit)
        },
        doctors: {
          page: query.doctorPage,
          pageSize: query.limit,
          totalRecords: totalDoctors,
          totalPages: Math.ceil(totalDoctors / query.limit)
        }
      },
      statistics: { facilities: allFacilityCount, doctors: allDoctorCount },
      filters: {
        districts: districts.filter((value): value is string => typeof value === "string").sort(),
        mandals: mandals.filter((value): value is string => typeof value === "string").sort(),
        facilityTypes: facilityTypes.filter((value): value is string => typeof value === "string").sort(),
        specializations: [...new Set(specialties.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))].sort()
      }
    });
  } catch (error) { next(error); }
};
