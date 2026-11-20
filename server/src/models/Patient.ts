import mongoose, { Schema, type InferSchemaType } from "mongoose";
const patientSchema = new Schema({
  name: { type: String, required: true }, phone: String, address: String,
  gender: { type: String, enum: ["female", "male", "other", "prefer_not_to_say"] },
  district: String, village: String,
  dateOfBirth: String,
  nameNormalized: { type: String, required: true, index: true }, nameTelugu: String,
  phoneHash: { type: String, index: true },
  abha: String, aarogyasri: String, mandal: { type: String, required: true },
  preferredLanguage: { type: String, enum: ["en", "te", "hi"], default: "en" },
  ageYears: { type: Number, min: 0 },
  mandalId: { type: Schema.Types.ObjectId, ref: "Mandal", index: true },
  phcId: { type: Schema.Types.ObjectId, ref: "Phc", index: true },
  villageId: { type: Schema.Types.ObjectId, ref: "Village", index: true },
  habitationId: { type: Schema.Types.ObjectId, ref: "Habitation", index: true },
  clientUuid: { type: String, sparse: true, unique: true }, patientCode: String,
  version: { type: Number, default: 1 }, active: { type: Boolean, default: true },
  registrationStatus: { type: String, enum: ["pending_verification", "verified"], index: true },
  phoneVerifiedAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });
patientSchema.index({ nameNormalized: 1, mandal: 1 });
export type PatientDocument = InferSchemaType<typeof patientSchema> & { _id: mongoose.Types.ObjectId };
export const Patient = mongoose.models.Patient || mongoose.model("Patient", patientSchema);
