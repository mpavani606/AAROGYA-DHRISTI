import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  image: { type: Schema.Types.ObjectId, ref: "CaseImage", required: true },
  provider: { type: String, enum: ["gemini"], required: true },
  model: { type: String, required: true },
  imageQuality: { type: String, enum: ["adequate", "limited", "uncertain"], required: true },
  visibleDescription: { type: String, required: true, maxlength: 800 },
  consentVersion: { type: String, required: true }
}, { timestamps: true });

schema.index({ image: 1, provider: 1 }, { unique: true });
export const GeminiScreeningObservation = mongoose.models.GeminiScreeningObservation
  || mongoose.model("GeminiScreeningObservation", schema);
