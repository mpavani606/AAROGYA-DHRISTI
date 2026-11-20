import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  clientUuid: { type: String, required: true },
  deviceId: { type: String, required: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  opType: { type: String, required: true },
  result: Schema.Types.Mixed,
  entityId: String,
  createdAt: { type: Date, default: Date.now }
});
schema.index({ deviceId: 1, clientUuid: 1, user: 1 }, { unique: true });
export const SyncItem = mongoose.models.SyncItem || mongoose.model("SyncItem", schema);
