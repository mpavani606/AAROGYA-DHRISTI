import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  task: { type: Schema.Types.ObjectId, ref: "NavigatorTask", required: true, index: true },
  attemptedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  channel: { type: String, enum: ["phone", "home_visit", "sms"], required: true },
  outcome: { type: String, enum: ["reached", "no_answer", "wrong_number", "promised_follow_up"], required: true },
  notes: { type: String, maxlength: 2000 }
}, { timestamps: true });
export const ContactAttempt = mongoose.models.ContactAttempt || mongoose.model("ContactAttempt", schema);
