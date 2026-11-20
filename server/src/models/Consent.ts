import mongoose, { Schema } from "mongoose";
const schema = new Schema({ patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true }, purpose: { type: String, required: true }, granted: { type: Boolean, required: true }, grantedBy: { type: Schema.Types.ObjectId, ref: "User" }, clientUuid: { type: String, sparse: true, unique: true }, consentVersion: String, expiresAt: Date }, { timestamps: true });
schema.index({ patient: 1, purpose: 1, granted: 1 });
export const Consent = mongoose.models.Consent || mongoose.model("Consent", schema);
