import mongoose, { Schema } from "mongoose";
export const investigationStatuses = ["advised", "scheduled", "collected", "report_received", "reviewed", "cancelled"] as const;
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  type: { type: String, enum: ["biopsy", "histopathology", "ct", "mri"], required: true },
  status: { type: String, enum: investigationStatuses, default: "advised" },
  advisedAt: { type: Date, default: Date.now },
  scheduledAt: Date,
  collectedAt: Date,
  reportReceivedAt: Date,
  reviewedAt: Date
}, { timestamps: true });
export const Investigation = mongoose.models.Investigation || mongoose.model("Investigation", schema);
