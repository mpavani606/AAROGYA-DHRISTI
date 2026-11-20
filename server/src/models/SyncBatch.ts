import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  idempotencyKey: { type: String, required: true },
  deviceId: { type: String, required: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  result: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ idempotencyKey: 1, deviceId: 1, user: 1 }, { unique: true });
export const SyncBatch = mongoose.models.SyncBatch || mongoose.model("SyncBatch", schema);
