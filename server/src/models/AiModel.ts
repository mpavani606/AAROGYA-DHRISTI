import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  version: { type: String, required: true },
  license: { type: String, required: true, default: "Demo" },
  permitted_use: { type: String, required: true, default: "Demonstration and research only" },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  redFlagTaskType: String,
  metadata: Schema.Types.Mixed
}, { timestamps: true });
export const AiModel = mongoose.models.AiModel || mongoose.model("AiModel", schema);
