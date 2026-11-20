import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
  type: { type: String, required: true },
  status: { type: String, enum: ["open", "done"], default: "open" },
  source: { type: String, enum: ["ai", "manual"], required: true },
  details: Schema.Types.Mixed
}, { timestamps: true });
export const Task = mongoose.models.Task || mongoose.model("Task", schema);
