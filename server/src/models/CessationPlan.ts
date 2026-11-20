import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  goal: { type: String, required: true, maxlength: 500 },
  targetDate: Date,
  steps: [{ type: String, maxlength: 500 }],
  status: { type: String, enum: ["active", "completed", "cancelled"], default: "active" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
export const CessationPlan = mongoose.models.CessationPlan || mongoose.model("CessationPlan", schema);
