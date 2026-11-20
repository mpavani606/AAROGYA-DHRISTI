import type { RequestHandler } from "express";
import { z } from "zod";
import { MedicineRefillRequest } from "../models/MedicineRefillRequest.js";
import { MedicalRecord } from "../models/MedicalRecord.js";
import { Prescription } from "../models/Prescription.js";
import { Patient } from "../models/Patient.js";
import { Habit } from "../models/Habit.js";
import { Symptom } from "../models/Symptom.js";
import { District, Hospital, Mandal, Phc, Village } from "../models/Geo.js";
import { MedicineInventory } from "../models/MedicineInventory.js";
import { User } from "../models/User.js";
import { encryptPatientFields, phoneHashVariants, presentPatient } from "../services/patientService.js";
import { queuePatientNotification } from "../services/workflowNotificationService.js";

async function findOwnPatient(req: Parameters<RequestHandler>[0]) {
  if (req.user?.role !== "patient" || !req.user.phone) return { error: "FORBIDDEN" as const };
  const patients = await Patient.find({ phoneHash: { $in: phoneHashVariants(req.user.phone) }, active: true }).limit(2);
  if (patients.length !== 1) return { error: patients.length ? "PATIENT_LINK_AMBIGUOUS" as const : "NOT_FOUND" as const };
  return { patient: patients[0] };
}

const medicineKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getOwnMedicineAvailability: RequestHandler = async (req, res, next) => {
  try {
    const query = z.object({ medicineName: z.string().trim().min(1).max(160) }).strict().parse(req.query);
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: "Unable to resolve the patient record linked to this account." }
    });
    const mandal = result.patient.mandalId
      ? await Mandal.findById(result.patient.mandalId).select("district")
      : await Mandal.findOne({
        $or: [
          { name: result.patient.mandal },
          { name_en: result.patient.mandal },
          { name_te: result.patient.mandal },
          { code: result.patient.mandal }
        ]
      }).select("district");
    const district = mandal?.district
      ? await District.findById(mandal.district).select("_id")
      : result.patient.district
        ? await District.findOne({ $or: [{ name: result.patient.district }, { name_en: result.patient.district }, { name_te: result.patient.district }] }).select("_id")
        : null;
    if (!district) return res.json({ medicineName: query.medicineName, availability: "not_recorded", facilities: [] });
    const mandalIds = await Mandal.find({ district: district._id }).distinct("_id");
    const hospitals = await Hospital.find({
      active: true,
      $or: [{ district: district._id }, { mandal: { $in: mandalIds } }, { mandalId: { $in: mandalIds } }]
    }).select("_id name address phone").lean();
    const inventory = await MedicineInventory.find({
      hospital: { $in: hospitals.map((hospital) => String(hospital._id)) },
      medicineKey: { $regex: escapeRegex(medicineKey(query.medicineName)), $options: "i" }
    }).sort({ quantity: -1 }).lean();
    const hospitalById = new Map(hospitals.map((hospital) => [String(hospital._id), hospital]));
    const facilities = inventory.map((item) => {
      const hospital = hospitalById.get(item.hospital.toString());
      return {
        medicineName: item.medicineName,
        hospital: hospital?.name ?? "",
        address: hospital?.address ?? null,
        phone: hospital?.phone ?? null,
        quantity: item.quantity,
        unit: item.unit,
        availability: item.quantity > 0 ? "available" as const : "out_of_stock" as const,
        synthetic: Boolean(item.synthetic),
        updatedAt: item.updatedAt
      };
    });
    res.json({
      medicineName: query.medicineName,
      availability: facilities.length ? "recorded" : "not_found",
      facilities
    });
  } catch (error) { next(error); }
};

export const getOwnHealthSummary: RequestHandler = async (req, res, next) => {
  try {
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: "Unable to resolve the patient record linked to this account." }
    });
    const [habits, symptoms, records, phc, village] = await Promise.all([
      Habit.find({ patient: result.patient._id, stoppedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(50).select("name frequency quantity unit startedAt notes"),
      Symptom.find({ patient: result.patient._id }).sort({ createdAt: -1 }).limit(50).select("name severity durationDays notes"),
      MedicalRecord.find({ patient: result.patient._id, deletedAt: { $exists: false }, supersededAt: { $exists: false } }).sort({ recordDate: -1, createdAt: -1 }).limit(100).select("recordType title recordDate sourceHospital sourceHospitalType sourceDoctor notes"),
      result.patient.phcId ? Phc.findById(result.patient.phcId).select("name name_en name_te code address phone") : null,
      result.patient.villageId ? Village.findById(result.patient.villageId).select("name name_en name_te code") : null
    ]);
    res.json({
      patient: presentPatient(result.patient),
      location: {
        village: village?.name_en ?? village?.name_te ?? village?.name ?? presentPatient(result.patient).village ?? null,
        phc: phc ? {
          name: phc.name_en ?? phc.name_te ?? phc.name,
          code: phc.code ?? null,
          address: phc.address ?? null,
          phone: phc.phone ?? null
        } : null
      },
      riskFactors: habits,
      symptoms,
      medicalHistory: records
    });
  } catch (error) { next(error); }
};

export const getOwnHealthWorkers: RequestHandler = async (req, res, next) => {
  try {
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: "Unable to resolve the patient record linked to this account." }
    });
    const patient = result.patient;
    const assignments = [
      ...(patient.villageId ? [{ village: patient.villageId.toString() }] : []),
      ...(patient.phcId ? [{ phc: patient.phcId.toString() }] : []),
      ...(patient.mandalId ? [{ mandal: patient.mandalId.toString() }] : []),
      ...(patient.mandal ? [{ mandal: patient.mandal }] : [])
    ];
    if (!assignments.length) return res.setHeader("Cache-Control", "no-store").json({ workers: [] });
    const candidates = await User.find({
      role: "asha_worker",
      status: "active",
      $or: assignments.map((assignment) => ({ assignments: { $elemMatch: assignment } }))
    }).select("_id name phone email assignments").sort({ name: 1 }).limit(100);
    type WorkerAssignment = { mandal?: string; phc?: string; village?: string; habitation?: string };
    const workers = candidates.filter((worker) => (worker.assignments as WorkerAssignment[]).some((assignment: WorkerAssignment) =>
      Boolean(assignment.village || assignment.phc)
      && (!assignment.mandal || assignment.mandal === patient.mandalId?.toString() || assignment.mandal.toLocaleLowerCase() === patient.mandal?.toLocaleLowerCase())
      && (!assignment.phc || assignment.phc === patient.phcId?.toString())
      && (!assignment.village || assignment.village === patient.villageId?.toString())
      && (!assignment.habitation || assignment.habitation === patient.habitationId?.toString())
    )).map((worker) => ({
      id: worker._id.toString(),
      name: worker.name,
      phone: worker.phone ?? null,
      email: worker.email ?? null
    }));
    res.setHeader("Cache-Control", "no-store").json({ workers });
  } catch (error) { next(error); }
};

export const updateOwnPatientProfile: RequestHandler = async (req, res, next) => {
  try {
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: result.error === "NOT_FOUND" ? "No patient record is linked to this account." : "Patient account access is unavailable." }
    });
    const body = z.object({
      name: z.string().trim().min(2).max(200).optional(),
      address: z.string().trim().max(500).optional(),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
      }).optional(),
      gender: z.enum(["female", "male", "other", "prefer_not_to_say"]).optional()
    }).strict().refine((value) => Object.keys(value).length > 0).parse(req.body);
    const patient = await Patient.findOneAndUpdate(
      { _id: result.patient._id, version: result.patient.version },
      { $set: encryptPatientFields(body), $inc: { version: 1 } },
      { new: true }
    );
    if (!patient) return res.status(409).json({ error: { code: "VERSION_CONFLICT", message_en: "Your profile changed. Reload and try again." } });
    res.json({ patient: presentPatient(patient) });
  } catch (error) { next(error); }
};

const refillBody = z.object({
  clientUuid: z.string().uuid().optional(),
  prescriptionRecordId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  prescriptionId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  medicineName: z.string().trim().min(1).max(160),
  dosage: z.string().trim().max(160).optional(),
  quantity: z.coerce.number().int().min(1).max(365),
  notes: z.string().trim().max(500).optional()
}).strict().refine((value) => !(value.prescriptionId && value.prescriptionRecordId), "Select only one prescription reference.");

const prescriptionBody = z.object({
  medicineName: z.string().trim().min(1).max(160),
  dosage: z.string().trim().min(1).max(160),
  doctor: z.string().trim().max(160).optional(),
  prescriptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
  }),
  notes: z.string().trim().max(1000).optional()
}).strict();

export const listOwnPrescriptions: RequestHandler = async (req, res, next) => {
  try {
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: "Unable to resolve the patient record linked to this account." }
    });
    const prescriptions = await Prescription.find({ patient: result.patient._id, isDemoData: { $ne: true } }).sort({ prescriptionDate: -1, createdAt: -1 }).limit(100).lean();
    res.json({ prescriptions });
  } catch (error) { next(error); }
};

export const createOwnPrescription: RequestHandler = async (req, res, next) => {
  try {
    const body = prescriptionBody.parse(req.body);
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: "Unable to resolve the patient record linked to this account." }
    });
    const prescription = await Prescription.create({
      ...body,
      doctor: body.doctor || "Not recorded",
      patient: result.patient._id,
      createdBy: req.user!.id,
      source: "patient_reported"
    });
    res.status(201).json({ prescription });
  } catch (error) { next(error); }
};

export const listOwnRefillRequests: RequestHandler = async (req, res, next) => {
  try {
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: "Unable to resolve the patient record linked to this account." }
    });
    const requests = await MedicineRefillRequest.find({ patient: result.patient._id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ requests, availability: "unknown" });
  } catch (error) { next(error); }
};

export const createOwnRefillRequest: RequestHandler = async (req, res, next) => {
  try {
    const body = refillBody.parse(req.body);
    const result = await findOwnPatient(req);
    if (!result.patient) return res.status(result.error === "FORBIDDEN" ? 403 : result.error === "NOT_FOUND" ? 404 : 409).json({
      error: { code: result.error, message_en: "Unable to resolve the patient record linked to this account." }
    });
    if (body.prescriptionRecordId && !await MedicalRecord.exists({
      _id: body.prescriptionRecordId,
      patient: result.patient._id,
      recordType: { $regex: "prescription", $options: "i" },
      deletedAt: { $exists: false }
    })) {
      return res.status(404).json({ error: { code: "PRESCRIPTION_NOT_FOUND", message_en: "The selected prescription was not found in your records." } });
    }
    if (body.prescriptionId && !await Prescription.exists({ _id: body.prescriptionId, patient: result.patient._id, isDemoData: { $ne: true } })) {
      return res.status(404).json({ error: { code: "PRESCRIPTION_NOT_FOUND", message_en: "The selected prescription was not found in your records." } });
    }
    const { prescriptionId, ...requestBody } = body;
    const request = body.clientUuid
      ? await MedicineRefillRequest.findOneAndUpdate(
        { patient: result.patient._id, clientUuid: body.clientUuid },
        { $setOnInsert: { ...requestBody, prescription: prescriptionId, patient: result.patient._id, clientUuid: body.clientUuid, status: "pending" } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
      : await MedicineRefillRequest.create({ ...requestBody, prescription: prescriptionId, patient: result.patient._id, status: "pending" });
    await queuePatientNotification({
      eventKey: `refill:${request._id}`,
      patientId: result.patient._id.toString(),
      template: "refill_request_submitted"
    });
    res.status(201).json({ request, availability: "unknown" });
  } catch (error) { next(error); }
};
