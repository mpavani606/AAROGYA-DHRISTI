import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  clientUuid: { type: String, sparse: true, unique: true },
  prescriptionRecord: { type: Schema.Types.ObjectId, ref: "MedicalRecord" },
  prescription: { type: Schema.Types.ObjectId, ref: "Prescription" },
  medicineName: { type: String, required: true, trim: true, maxlength: 160 },
  dosage: { type: String, trim: true, maxlength: 160 },
  quantity: { type: Number, required: true, min: 1, max: 365 },
  notes: { type: String, trim: true, maxlength: 500 },
  status: { type: String, enum: ["pending", "requested", "reviewed", "fulfilled", "declined"], default: "pending" }
}, { timestamps: true });

schema.index({ patient: 1, createdAt: -1 });
export const MedicineRefillRequest = mongoose.models.MedicineRefillRequest || mongoose.model("MedicineRefillRequest", schema);
