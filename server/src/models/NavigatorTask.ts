import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
  type: { type: String, enum: ["appointment_reminder", "missed_visit", "sla_escalation", "contact", "transport"], required: true },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: ["open", "in_progress", "done", "cancelled"], default: "open" },
  escalated: { type: Boolean, default: false },
  riskPoints: { type: Number, default: 0 },
  riskBand: { type: String, enum: ["Low", "Medium", "High"] },
  details: Schema.Types.Mixed
}, { timestamps: true });
export const NavigatorTask = mongoose.models.NavigatorTask || mongoose.model("NavigatorTask", schema);
