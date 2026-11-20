import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  reviewer: { type: Schema.Types.ObjectId, ref: "User", required: true },
  decision: { type: String, enum: ["agree", "disagree", "defer"], required: true },
  reason: { type: String, required: true, minlength: 3, maxlength: 5000 },
  findings: { type: String, maxlength: 10000 },
  aiAgreement: { type: String, enum: ["agree", "disagree", "not_applicable"], required: true },
  signedAt: { type: Date },
  version: { type: Number, required: true, min: 1 }
}, { timestamps: true });
schema.index({ case: 1, version: 1 }, { unique: true });
export const Review = mongoose.models.Review || mongoose.model("Review", schema);
