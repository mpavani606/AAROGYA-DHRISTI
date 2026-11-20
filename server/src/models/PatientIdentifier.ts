import mongoose, { Schema } from "mongoose";
const schema = new Schema({ patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true }, type: { type: String, required: true }, valueHash: { type: String, required: true, unique: true } }, { timestamps: true });
export const PatientIdentifier = mongoose.models.PatientIdentifier || mongoose.model("PatientIdentifier", schema);
