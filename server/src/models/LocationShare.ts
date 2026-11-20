import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  source: { type: String, enum: ["patient_link", "asha_gps", "address"], required: true },
  consent: { type: Schema.Types.ObjectId, ref: "Consent", required: true },
  tokenHash: { type: String, unique: true, sparse: true, select: false },
  sharedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
export const LocationShare = mongoose.models.LocationShare || mongoose.model("LocationShare", schema);
