import mongoose, { Schema, type InferSchemaType } from "mongoose";

const medicalRecordSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  author: { type: Schema.Types.ObjectId, ref: "User", required: true },
  recordType: { type: String, required: true, trim: true, maxlength: 80 },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  recordDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
  sourceHospital: { type: String, trim: true, maxlength: 200 },
  sourceHospitalType: { type: String, enum: ["government", "private"] },
  sourceDoctor: { type: String, trim: true, maxlength: 200 },
  notes: { type: String, maxlength: 10000 },
  media: [{ type: Schema.Types.ObjectId, ref: "MediaObject" }],
  version: { type: Number, default: 1 },
  previousVersion: { type: Schema.Types.ObjectId, ref: "MedicalRecord" },
  supersededAt: Date,
  deletedAt: Date
}, { timestamps: true });

medicalRecordSchema.index({ patient: 1, createdAt: -1 });
export type MedicalRecordDocument = InferSchemaType<typeof medicalRecordSchema> & { _id: mongoose.Types.ObjectId };
export const MedicalRecord = mongoose.models.MedicalRecord || mongoose.model("MedicalRecord", medicalRecordSchema);
