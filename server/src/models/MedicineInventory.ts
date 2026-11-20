import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true, index: true },
  medicineName: { type: String, required: true, trim: true, maxlength: 160 },
  medicineKey: { type: String, required: true, trim: true, maxlength: 160 },
  quantity: { type: Number, required: true, min: 0, max: 1_000_000 },
  unit: { type: String, required: true, trim: true, maxlength: 40 },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  synthetic: { type: Boolean, default: false }
}, { timestamps: true });

schema.index({ hospital: 1, medicineKey: 1 }, { unique: true });
export const MedicineInventory = mongoose.models.MedicineInventory || mongoose.model("MedicineInventory", schema);
