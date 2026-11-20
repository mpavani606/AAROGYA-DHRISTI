import mongoose, { Schema } from "mongoose";

const campSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  startsAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true },
  status: { type: String, enum: ["planned", "open", "completed", "cancelled"], default: "planned", index: true },
  mandal: { type: Schema.Types.ObjectId, ref: "Mandal", required: true, index: true },
  phc: { type: Schema.Types.ObjectId, ref: "Phc", required: true, index: true },
  village: { type: Schema.Types.ObjectId, ref: "Village", required: true, index: true },
  hospital: { type: Schema.Types.ObjectId, ref: "Hospital" },
  assignedDoctors: [{ type: Schema.Types.ObjectId, ref: "User" }],
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  notes: { type: String, trim: true, maxlength: 2000 }
}, { timestamps: true });

campSchema.index({ status: 1, startsAt: 1, mandal: 1 });
export const HealthCamp = mongoose.models.HealthCamp || mongoose.model("HealthCamp", campSchema);

const participantSchema = new Schema({
  camp: { type: Schema.Types.ObjectId, ref: "HealthCamp", required: true, index: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  case: { type: Schema.Types.ObjectId, ref: "Case" },
  status: { type: String, enum: ["registered", "attended", "no_show"], default: "registered", index: true },
  registeredBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  attendedAt: Date
}, { timestamps: true });

participantSchema.index({ camp: 1, patient: 1 }, { unique: true });
export const CampParticipant = mongoose.models.CampParticipant || mongoose.model("CampParticipant", participantSchema);
