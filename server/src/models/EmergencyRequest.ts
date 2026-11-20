import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  clientRequestId: { type: String, required: true },
  category: { type: String, enum: ["urgent_help", "transport", "other"], required: true },
  message: { type: String, trim: true, maxlength: 500 },
  locationShare: { type: Schema.Types.ObjectId, ref: "LocationShare" },
  emergencyContactEncrypted: { type: String, select: false },
  emergencyContactConsentAt: Date,
  emergencyContactConsentVersion: String,
  status: { type: String, enum: ["submitted", "open", "assigned", "acknowledged", "resolved", "cancelled"], default: "submitted", index: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  assignedBy: { type: Schema.Types.ObjectId, ref: "User" },
  resolutionNote: { type: String, trim: true, maxlength: 500 },
  resolutionNoteEncrypted: { type: String, select: false },
  statusHistory: [{
    status: { type: String, enum: ["submitted", "open", "assigned", "acknowledged", "resolved", "cancelled"], required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    changedAt: { type: Date, required: true }
  }],
  contactAttempts: [{
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    attemptedAt: { type: Date, required: true },
    channel: { type: String, enum: ["phone", "inapp", "sms"], required: true },
    outcome: { type: String, enum: ["reached", "no_answer", "unavailable", "not_attempted"], required: true },
    noteEncrypted: String
  }],
  escalations: [{
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    escalatedAt: { type: Date, required: true },
    reasonEncrypted: { type: String, required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" }
  }]
}, { timestamps: true });

schema.index({ patient: 1, clientRequestId: 1 }, { unique: true });
schema.index({ status: 1, createdAt: 1 });
export const EmergencyRequest = mongoose.models.EmergencyRequest || mongoose.model("EmergencyRequest", schema);
