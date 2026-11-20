import mongoose, { Schema, type InferSchemaType } from "mongoose";

const mediaObjectSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  record: { type: Schema.Types.ObjectId, ref: "MedicalRecord" },
  originalName: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true, enum: ["application/pdf", "image/jpeg", "image/png"] },
  size: { type: Number, required: true, max: 10 * 1024 * 1024 },
  sha256: { type: String, required: true, index: true },
  storage: { type: String, enum: ["cloudinary", "local"], required: true },
  storageKey: { type: String, required: true, unique: true },
  encryptedAtRest: { type: Boolean, default: false },
  width: Number,
  height: Number,
  deletedAt: Date
}, { timestamps: true });

export type MediaObjectDocument = InferSchemaType<typeof mediaObjectSchema> & { _id: mongoose.Types.ObjectId };
export const MediaObject = mongoose.models.MediaObject || mongoose.model("MediaObject", mediaObjectSchema);
