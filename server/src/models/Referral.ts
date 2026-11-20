import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  fromUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
  sourceHospital: { type: Schema.Types.ObjectId, ref: "Hospital" },
  toSpecialty: { type: String, required: true, maxlength: 120 },
  hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
  referralCode: { type: String, unique: true, sparse: true, index: true },
  priority: { type: String, enum: ["routine", "urgent"], required: true },
  reason: { type: String, required: true, maxlength: 5000 },
  appointment: { type: Schema.Types.ObjectId, ref: "Appointment" },
  appointmentDetails: { type: String, maxlength: 1000 },
  status: { type: String, enum: ["not_required", "recommended", "requested", "accepted", "scheduled", "completed", "cancelled"], default: "requested" }
}, { timestamps: true });
export const Referral = mongoose.models.Referral || mongoose.model("Referral", schema);
