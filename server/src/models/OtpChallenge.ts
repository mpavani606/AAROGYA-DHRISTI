import mongoose, { Schema } from "mongoose";

const otpChallengeSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  phoneHash: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attempts: { type: Number, default: 0, max: 5 },
  consumedAt: Date
}, { timestamps: true });

export const OtpChallenge = mongoose.models.OtpChallenge || mongoose.model("OtpChallenge", otpChallengeSchema);
