import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  stage: { type: String, required: true },
  priorityBand: { type: String, enum: ["routine_follow_up", "specialist_review", "urgent_referral"] },
  targetHours: { type: Number, required: true, min: 1 },
  escalateTo: { type: String, enum: ["navigator", "doctor", "district_admin"], required: true }
});
schema.index({ stage: 1, priorityBand: 1 }, { unique: true });
export const SlaRule = mongoose.models.SlaRule || mongoose.model("SlaRule", schema);
