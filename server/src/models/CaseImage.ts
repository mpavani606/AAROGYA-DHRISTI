import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  originalName: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true, enum: ["image/jpeg", "image/png", "image/webp"] },
  size: { type: Number, required: true },
  storageKey: { type: String, required: true, unique: true },
  width: Number,
  height: Number,
  sha256: String,
  qualityStatus: { type: String, enum: ["usable", "insufficient", "unassessed"], default: "unassessed", index: true },
  encryptedAtRest: { type: Boolean, default: false }
}, { timestamps: true });
export const CaseImage = mongoose.models.CaseImage || mongoose.model("CaseImage", schema);
