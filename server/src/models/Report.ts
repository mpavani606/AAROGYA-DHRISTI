import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  investigation: { type: Schema.Types.ObjectId, ref: "Investigation", required: true, index: true },
  media: { type: Schema.Types.ObjectId, ref: "MediaObject" },
  summary: { type: String, required: true, maxlength: 10000 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reviewedAt: Date
}, { timestamps: true });
export const Report = mongoose.models.Report || mongoose.model("Report", schema);
