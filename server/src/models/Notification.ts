import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", index: true },
  user: { type: Schema.Types.ObjectId, ref: "User", index: true },
  channel: { type: String, enum: ["inapp", "sms", "push"], required: true },
  template: { type: String, required: true },
  language: { type: String, enum: ["te", "en", "hi"], required: true },
  variables: Schema.Types.Mixed,
  status: { type: String, enum: ["queued", "sent", "failed", "read"], default: "queued" },
  dedupeKey: { type: String, unique: true, sparse: true, select: false },
  sentAt: Date,
  attempts: { type: Number, default: 0 },
  nextAttemptAt: Date
}, { timestamps: true });
export const Notification = mongoose.models.Notification || mongoose.model("Notification", schema);
