import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  deviceId: { type: String, required: true },
  clientUuid: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: String,
  localPayload: { type: Schema.Types.Mixed, required: true },
  serverUpdatedAt: Date,
  status: { type: String, enum: ["pending", "resolved"], default: "pending" }
}, { timestamps: true });
export const ConflictReview = mongoose.models.ConflictReview || mongoose.model("ConflictReview", schema);
