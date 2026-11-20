import mongoose, { Schema } from "mongoose";
const schema = new Schema({ patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true }, member: { type: Schema.Types.ObjectId, ref: "Patient", required: true }, relation: { type: String, required: true }, status: { type: String, enum: ["active", "revoked"], default: "active" } }, { timestamps: true });
schema.index({ patient: 1, member: 1 }, { unique: true });
export const FamilyLink = mongoose.models.FamilyLink || mongoose.model("FamilyLink", schema);
