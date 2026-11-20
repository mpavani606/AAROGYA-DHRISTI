import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  clientUuid: { type: String, sparse: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  severity: { type: String, enum: ["mild", "moderate", "severe"], default: "mild" },
  durationDays: { type: Number, min: 0 },
  notes: { type: String, maxlength: 2000 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
export const Symptom = mongoose.models.Symptom || mongoose.model("Symptom", schema);
