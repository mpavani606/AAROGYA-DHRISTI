import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  clientUuid: { type: String, sparse: true, unique: true },
  status: { type: String, enum: ["draft", "submitted", "ai_processed", "in_review", "routine_follow_up", "specialist_review", "urgent_referral", "recapture_requested", "deferred", "investigation_advised", "report_received", "clinician_reviewed", "treatment_linked", "follow_up", "closed_clinically", "lost_to_follow_up"], default: "draft", index: true },
  priorityBand: { type: String, enum: ["routine_follow_up", "specialist_review", "urgent_referral"] },
  riskScore: { type: Number, min: 0, max: 100 },
  riskFactors: [{ rule: String, points: Number, evidence: String }],
  notes: { type: String, maxlength: 10000 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
export const Case = mongoose.models.Case || mongoose.model("Case", schema);
