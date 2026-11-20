import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  uploadId: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  deviceId: { type: String, required: true },
  caseId: { type: String, required: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  totalChunks: { type: Number, required: true },
  chunks: [{ index: Number, data: Buffer }],
  status: { type: String, enum: ["uploading", "complete"], default: "uploading" },
  completedAt: Date
}, { timestamps: true });
export const ChunkUpload = mongoose.models.ChunkUpload || mongoose.model("ChunkUpload", schema);
