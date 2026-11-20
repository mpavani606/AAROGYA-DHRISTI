import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", index: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  type: { type: String, enum: ["video", "physical"], required: true },
  clinician: { type: Schema.Types.ObjectId, ref: "User", required: true },
  hospital: { type: Schema.Types.ObjectId, ref: "Hospital" },
  availabilityId: { type: Schema.Types.ObjectId },
  clientUuid: { type: String, unique: true, sparse: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  status: { type: String, enum: ["requested", "confirmed", "rescheduled", "attended", "missed", "cancelled", "assessment_completed"], default: "requested" },
  tokenNo: String,
  missedReason: String
}, { timestamps: true });
schema.index({ clinician: 1, startAt: 1, endAt: 1 });
export const Appointment = mongoose.models.Appointment || mongoose.model("Appointment", schema);
