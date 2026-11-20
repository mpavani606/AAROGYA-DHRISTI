import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  worker: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  visitedAt: { type: Date, required: true, index: true },
  outcome: { type: String, enum: ["contacted", "not_available", "follow_up_needed", "referred"], required: true },
  nextFollowUpAt: Date,
  notesEncrypted: { type: String, maxlength: 12000 }
}, { timestamps: true });

schema.index({ worker: 1, nextFollowUpAt: 1 });
export const CommunityVisit = mongoose.models.CommunityVisit || mongoose.model("CommunityVisit", schema);
