import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const activeUserRoles = ["patient", "doctor", "hospital_manager", "district_admin", "system_admin", "asha_worker"] as const;
export type ActiveUserRole = typeof activeUserRoles[number];

const userSchema = new Schema({
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, sparse: true, unique: true },
  username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: [...activeUserRoles, "employee"], default: "patient", index: true },
  subRole: { type: String, enum: ["asha", "navigator", "hospital_staff", "medical_officer", "specialist"] },
  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", index: true },
  passwordSetupTokenHash: { type: String, select: false },
  passwordSetupExpiresAt: Date,
  tokenVersion: { type: Number, default: 0 },
  language: { type: String, enum: ["en", "te", "hi"] },
  status: { type: String, enum: ["active", "locked", "disabled"], default: "active" },
  assignments: [{ scope: String, district: String, mandal: String, village: String, habitation: String, phc: String, hospital: String }],
  locale: { type: String, enum: ["en", "te", "hi"], default: "en" },
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false },
  relationships: [{ user: { type: Schema.Types.ObjectId, ref: "User" }, relation: String }],
  refreshTokenHash: { type: String, select: false },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: Date,
  lastLoginAt: Date
}, { timestamps: true });

userSchema.index({ role: 1, hospitalId: 1 }, { partialFilterExpression: { role: "hospital_manager" } });

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
export const User = mongoose.models.User || mongoose.model("User", userSchema);
