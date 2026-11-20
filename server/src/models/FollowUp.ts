import mongoose, { Schema } from "mongoose";

const historySchema = new Schema({
  status: { type: String, enum: ["pending", "scheduled", "completed", "missed", "rescheduled", "cancelled"], required: true },
  scheduledAt: Date,
  changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  changedAt: { type: Date, required: true },
  note: { type: String, maxlength: 1000 }
}, { _id: false });

const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  referral: { type: Schema.Types.ObjectId, ref: "Referral" },
  appointment: { type: Schema.Types.ObjectId, ref: "Appointment" },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scheduledAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ["pending", "scheduled", "completed", "missed", "rescheduled", "cancelled"], default: "scheduled", index: true },
  notes: { type: String, maxlength: 5000 },
  history: { type: [historySchema], default: [] },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

schema.index({ patient: 1, scheduledAt: 1 });
schema.index({ assignedTo: 1, status: 1, scheduledAt: 1 });
export const FollowUp = mongoose.models.FollowUp || mongoose.model("FollowUp", schema);
