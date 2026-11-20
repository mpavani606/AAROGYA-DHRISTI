import type { RequestHandler } from "express";
import { Types } from "mongoose";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { Patient } from "../models/Patient.js";
import { Prescription } from "../models/Prescription.js";
import { User } from "../models/User.js";
import { decrypt } from "../services/encryption.js";
import { normalizeName } from "../services/patientService.js";

type PopulatedPatient = { _id: Types.ObjectId; name?: string; patientCode?: string };
type PopulatedDoctor = { _id: Types.ObjectId; name?: string };
type PrescriptionView = {
  _id: Types.ObjectId;
  patient?: PopulatedPatient | Types.ObjectId | null;
  doctorUser?: PopulatedDoctor | Types.ObjectId | null;
  prescriptionId?: string;
  isDemoData?: boolean;
  doctor?: string;
  prescriptionDate?: string;
  status?: string;
  medicineName?: string;
  dosage?: string;
  notes?: string;
  medicines?: Array<{
    medicineName: string;
    category: string;
    strength?: string;
    dosage: string;
    frequency?: string;
    durationDays?: number;
    quantity?: string;
    instructions?: string;
  }>;
  [key: string]: unknown;
};
type AssignedPatient = { _id: Types.ObjectId; nameNormalized?: string; patientCode?: string };

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "completed", "pending"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }).optional(),
  category: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10)
}).strict();

const statusInput = z.object({
  status: z.enum(["active", "completed", "pending"])
}).strict();

const fail = (res: Parameters<RequestHandler>[1], code: string, message_en: string, status = 400) =>
  res.status(status).json({ error: { code, message_en } });
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function assignedPatients(req: Parameters<RequestHandler>[0]) {
  const conditions: Record<string, unknown>[] = [{ createdBy: req.user!.id }];
  for (const assignment of req.user!.assignments ?? []) {
    if (assignment.mandal) {
      conditions.push(/^[a-f\d]{24}$/i.test(assignment.mandal)
        ? { $or: [{ mandalId: assignment.mandal }, { mandal: assignment.mandal }] }
        : { mandal: assignment.mandal });
    }
    if (assignment.phc && /^[a-f\d]{24}$/i.test(assignment.phc)) conditions.push({ phcId: assignment.phc });
    if (assignment.village && /^[a-f\d]{24}$/i.test(assignment.village)) conditions.push({ villageId: assignment.village });
    if (assignment.habitation && /^[a-f\d]{24}$/i.test(assignment.habitation)) conditions.push({ habitationId: assignment.habitation });
  }
  return Patient.find({ active: true, $or: conditions }).select("_id nameNormalized patientCode").lean<AssignedPatient[]>();
}

function presentPrescription(record: PrescriptionView) {
  const patient = record.patient;
  const patientWithName = patient && typeof patient === "object" && "name" in patient
    ? { ...patient, name: typeof patient.name === "string" ? decrypt(patient.name) : patient.name }
    : patient;
  const status = ["active", "completed", "pending", "cancelled"].includes(record.status ?? "") ? record.status : "pending";
  return {
    ...record,
    patient: patientWithName,
    status
  };
}

export const prescriptionDashboard: RequestHandler = async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const patients = await assignedPatients(req);
    const patientIds = patients.map((patient) => String(patient._id));
    const filter: Record<string, unknown> = { patient: { $in: patientIds } };

    if (query.q) {
      const text = query.q;
      const regex = new RegExp(escapeRegex(text), "i");
      const normalized = normalizeName(text);
      const matchingPatients = patients.filter((patient) =>
        (normalized && patient.nameNormalized?.includes(normalized)) ||
        (patient.patientCode && regex.test(patient.patientCode)) ||
        (/^[a-f\d]{24}$/i.test(text) && patient._id.toString() === text)
      ).map((patient) => String(patient._id));
      const matchingDoctors = await User.find({ role: "doctor", name: regex }).select("_id").lean();
      const alternatives: Record<string, unknown>[] = [
        { prescriptionId: regex },
        { medicineName: regex },
        { "medicines.medicineName": regex },
        { "medicines.category": regex },
        { doctor: regex },
        ...(matchingDoctors.length ? [{ doctorUser: { $in: matchingDoctors.map((doctor) => doctor._id) } }] : []),
        ...(matchingPatients.length ? [{ patient: { $in: matchingPatients } }] : [])
      ];
      if (/^[a-f\d]{24}$/i.test(text)) alternatives.push({ _id: text });
      filter.$or = alternatives;
    }
    if (query.status) filter.status = query.status;
    if (query.date) filter.prescriptionDate = query.date;
    if (query.category) filter["medicines.category"] = query.category;

    const [totalRecords, records, categories, statusGroups, demoCount] = await Promise.all([
      Prescription.countDocuments(filter),
      Prescription.find(filter)
        .sort({ prescriptionDate: -1, createdAt: -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate("patient", "name patientCode")
        .populate("doctorUser", "name")
        .lean<PrescriptionView[]>(),
      Prescription.distinct("medicines.category", { patient: { $in: patientIds } }),
      Prescription.aggregate([
        { $match: { patient: { $in: patientIds } } },
        { $group: { _id: { $ifNull: ["$status", "pending"] }, count: { $sum: 1 } } }
      ]),
      Prescription.countDocuments({ patient: { $in: patientIds }, isDemoData: true })
    ]);

    const counts = { active: 0, completed: 0, pending: 0, cancelled: 0 };
    for (const group of statusGroups as Array<{ _id: keyof typeof counts; count: number }>) {
      if (group._id in counts) counts[group._id] = group.count;
    }
    res.json({
      prescriptions: records.map((record) => presentPrescription(record)),
      pagination: {
        page: query.page,
        pageSize: query.limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / query.limit)
      },
      statistics: {
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
        ...counts,
        demo: demoCount
      },
      categories: categories.filter((category): category is string => typeof category === "string").sort()
    });
  } catch (error) { next(error); }
};

async function findAssignedPrescription(req: Parameters<RequestHandler>[0]) {
  const id = String(req.params.prescriptionId ?? req.params.id ?? "");
  const patients = await assignedPatients(req);
  const filter: Record<string, unknown> = { patient: { $in: patients.map((patient) => String(patient._id)) } };
  if (/^[a-f\d]{24}$/i.test(id)) filter._id = id;
  else filter.prescriptionId = id;
  return Prescription.findOne(filter)
    .populate("patient", "name patientCode")
    .populate("doctorUser", "name")
    .populate("medicines.medicine", "name category strength form")
    .lean<PrescriptionView | null>();
}

export const prescriptionDetails: RequestHandler = async (req, res, next) => {
  try {
    const prescription = await findAssignedPrescription(req);
    if (!prescription) return fail(res, "PRESCRIPTION_NOT_FOUND", "Prescription not found.", 404);
    res.json({ prescription: presentPrescription(prescription) });
  } catch (error) { next(error); }
};

export const downloadPrescriptionPdf: RequestHandler = async (req, res, next) => {
  try {
    const prescription = await findAssignedPrescription(req);
    if (!prescription) return fail(res, "PRESCRIPTION_NOT_FOUND", "Prescription not found.", 404);
    if (!prescription.isDemoData) return fail(res, "DEMO_PDF_ONLY", "PDF downloads are available for demo prescriptions only.", 403);

    const record = presentPrescription(prescription);
    const patient = record.patient && typeof record.patient === "object" && "name" in record.patient ? record.patient : null;
    const doctor = record.doctorUser && typeof record.doctorUser === "object" && "name" in record.doctorUser ? record.doctorUser : null;
    await AuditLog.create({
      actor: req.user!.id,
      action: "prescription.demo_pdf_downloaded",
      resource: "Prescription",
      resourceId: prescription._id.toString(),
      metadata: { isDemoData: true }
    });
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Demo prescription", Author: "Aarogya Drishti" } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const filename = (prescription.prescriptionId ?? "demo-prescription").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      res.type("application/pdf").send(Buffer.concat(chunks));
    });
    document.fontSize(18).text("Aarogya Drishti - Demo Prescription");
    document.moveDown().fontSize(13).fillColor("#9a3412").text("DEMO DATA - NOT A VALID MEDICAL PRESCRIPTION. NOT FOR CLINICAL USE.");
    document.fillColor("#000000").moveDown().fontSize(11);
    document.text(`Prescription ID: ${prescription.prescriptionId ?? prescription._id}`);
    document.text(`Patient: ${patient?.name ?? "Synthetic patient"} (${patient?.patientCode ?? "demo"})`);
    document.text(`Doctor: ${doctor?.name ?? prescription.doctor ?? "Synthetic doctor"}`);
    document.text(`Date: ${prescription.prescriptionDate}`);
    document.text(`Status: ${prescription.status}`);
    document.moveDown().fontSize(14).text("Medicine details");
    for (const medicine of prescription.medicines ?? []) {
      document.moveDown(0.5).fontSize(11).text(`${medicine.medicineName} - ${medicine.category}`);
      document.text(`Strength: ${medicine.strength ?? "Demo sample"} | Sample dosage: ${medicine.dosage}`);
      document.text(`Frequency: ${medicine.frequency ?? "Demo sample"} | Duration: ${medicine.durationDays ?? "-"} days`);
      document.text(`Instructions: ${medicine.instructions ?? "Demo-only sample; not for use."}`);
    }
    document.moveDown().fontSize(10).fillColor("#9a3412").text("Fictional data for software demonstration only. Do not use as treatment guidance.");
    document.end();
  } catch (error) { next(error); }
};

export const updatePrescriptionStatus: RequestHandler = async (req, res, next) => {
  try {
    const body = statusInput.parse(req.body);
    const patientId = String(req.params.patientId);
    const prescription = await Prescription.findOne({
      _id: req.params.prescriptionId,
      patient: patientId
    });
    if (!prescription) return fail(res, "PRESCRIPTION_NOT_FOUND", "Prescription not found.", 404);
    if (prescription.isDemoData) return fail(res, "DEMO_DATA_READ_ONLY", "Demo prescriptions cannot be approved or changed.", 403);
    prescription.status = body.status;
    if (body.status === "active") {
      prescription.approvedBy = new Types.ObjectId(req.user!.id);
      prescription.approvedAt = new Date();
    }
    await prescription.save();
    await AuditLog.create({
      actor: req.user!.id,
      action: body.status === "active" ? "prescription.approved" : "prescription.status_updated",
      resource: "Prescription",
      resourceId: prescription._id.toString(),
      metadata: { status: body.status }
    });
    res.json({ prescription });
  } catch (error) { next(error); }
};

export const voidPrescription: RequestHandler = async (req, res, next) => {
  try {
    const prescription = await Prescription.findOne({
      _id: req.params.prescriptionId,
      patient: req.params.patientId
    });
    if (!prescription) return fail(res, "PRESCRIPTION_NOT_FOUND", "Prescription not found.", 404);
    if (prescription.isDemoData) return fail(res, "DEMO_DATA_READ_ONLY", "Demo prescriptions cannot be deleted.", 403);
    if (prescription.createdBy.toString() !== req.user!.id) return fail(res, "FORBIDDEN", "Only the creating doctor can void this prescription.", 403);
    prescription.status = "cancelled";
    prescription.voidedBy = new Types.ObjectId(req.user!.id);
    prescription.voidedAt = new Date();
    await prescription.save();
    await AuditLog.create({
      actor: req.user!.id,
      action: "prescription.voided",
      resource: "Prescription",
      resourceId: prescription._id.toString(),
      metadata: { status: "cancelled", softDeleted: true }
    });
    res.json({ prescription, deleted: true });
  } catch (error) { next(error); }
};
