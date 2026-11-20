import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  status: { type: String, enum: ["completed", "failed", "unavailable"], required: true },
  resultCategory: { type: String, enum: ["INSUFFICIENT_IMAGE_QUALITY", "SUSPICIOUS_FEATURES_REQUIRE_REVIEW", "NO_SUSPICIOUS_FEATURES_IDENTIFIED", "AI_PROCESSING_UNAVAILABLE"] },
  modelVersion: { type: String, required: true },
  durationMs: { type: Number, required: true, min: 0 },
  errorCode: { type: String, maxlength: 80 }
}, { timestamps: true, strict: true });

schema.index({ createdAt: -1, status: 1 });
schema.index({ createdAt: -1, resultCategory: 1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const AiServiceEvent = mongoose.models.AiServiceEvent || mongoose.model("AiServiceEvent", schema);
