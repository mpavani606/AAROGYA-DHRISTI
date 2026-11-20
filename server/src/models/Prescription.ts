import mongoose, { Schema } from "mongoose";

const medicineEntrySchema = new Schema({
  medicine: { type: Schema.Types.ObjectId, ref: "Medicine" },
  medicineName: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  strength: { type: String, trim: true, maxlength: 80 },
  dosage: { type: String, required: true, trim: true, maxlength: 160 },
  frequency: { type: String, trim: true, maxlength: 120 },
  durationDays: { type: Number, min: 1, max: 3650 },
  quantity: { type: String, trim: true, maxlength: 80 },
  instructions: { type: String, trim: true, maxlength: 500 }
}, { _id: false });

const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  medicineName: { type: String, required: true, trim: true, maxlength: 160 },
  dosage: { type: String, required: true, trim: true, maxlength: 160 },
  doctor: { type: String, trim: true, maxlength: 160, default: "Not recorded" },
  doctorUser: { type: Schema.Types.ObjectId, ref: "User", index: true },
  prescriptionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  notes: { type: String, trim: true, maxlength: 1000 },
  source: { type: String, enum: ["patient_reported", "clinician", "demo"], default: "patient_reported" },
  medicines: { type: [medicineEntrySchema], default: [] },
  status: { type: String, enum: ["active", "completed", "pending", "cancelled"], default: "pending", index: true },
  prescriptionId: { type: String, trim: true, maxlength: 40 },
  isDemoData: { type: Boolean, default: false, index: true },
  demoRecordKey: { type: String, trim: true, maxlength: 80 },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  approvedAt: Date,
  voidedBy: { type: Schema.Types.ObjectId, ref: "User" },
  voidedAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

schema.index({ patient: 1, prescriptionDate: -1 });
schema.index({ demoRecordKey: 1 }, { unique: true, sparse: true });
schema.index({ prescriptionId: 1 }, { unique: true, sparse: true });
export const Prescription = mongoose.models.Prescription || mongoose.model("Prescription", schema);
