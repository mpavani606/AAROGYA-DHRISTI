import type { RequestHandler } from "express";
import { z } from "zod";
import { Medicine } from "../models/Medicine.js";
import { Prescription } from "../models/Prescription.js";

const medicineInput = z.object({
  code: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  strength: z.string().trim().max(80).optional(),
  form: z.string().trim().max(80).optional()
}).strict();

const medicineUpdate = medicineInput.partial().strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
const fail = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) =>
  res.status(status).json({ error: { code, message_en } });

export const listMedicines: RequestHandler = async (_req, res, next) => {
  try {
    const medicines = await Medicine.find().sort({ category: 1, name: 1 }).lean();
    res.json({ medicines });
  } catch (error) { next(error); }
};

export const createMedicine: RequestHandler = async (req, res, next) => {
  try {
    const body = medicineInput.parse(req.body);
    if (await Medicine.exists({ code: body.code })) return fail(res, "MEDICINE_CODE_EXISTS", "A medicine with this code already exists.", 409);
    const medicine = await Medicine.create({ ...body, synthetic: false });
    res.status(201).json({ medicine });
  } catch (error) { next(error); }
};

export const updateMedicine: RequestHandler = async (req, res, next) => {
  try {
    const body = medicineUpdate.parse(req.body);
    const medicine = await Medicine.findByIdAndUpdate(req.params.medicineId, { $set: body }, { new: true, runValidators: true });
    if (!medicine) return fail(res, "MEDICINE_NOT_FOUND", "Medicine not found.", 404);
    res.json({ medicine });
  } catch (error) { next(error); }
};

export const deleteMedicine: RequestHandler = async (req, res, next) => {
  try {
    const medicine = await Medicine.findById(req.params.medicineId).select("_id");
    if (!medicine) return fail(res, "MEDICINE_NOT_FOUND", "Medicine not found.", 404);
    if (await Prescription.exists({ "medicines.medicine": medicine._id })) {
      return fail(res, "MEDICINE_IN_USE", "This medicine is referenced by prescription records and cannot be deleted.", 409);
    }
    await medicine.deleteOne();
    res.json({ deleted: true });
  } catch (error) { next(error); }
};
