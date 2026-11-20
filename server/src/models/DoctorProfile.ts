import mongoose, { Schema } from "mongoose";
const documentSchema = new Schema({
  type: { type: String, enum: ["registration_certificate", "qualification", "experience_certificate", "identity", "other"], required: true },
  originalName: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, enum: ["application/pdf", "image/jpeg", "image/png"], required: true },
  size: { type: Number, required: true, max: 10 * 1024 * 1024 },
  sha256: { type: String, required: true },
  uploadId: { type: String, match: /^[a-f\d-]{36}$/i },
  storage: { type: String, enum: ["cloudinary", "local"], required: true },
  storageKey: { type: String, required: true },
  encryptedAtRest: { type: Boolean, default: false },
  reviewStatus: { type: String, enum: ["uploaded", "pending", "approved", "accepted", "rejected"], default: "uploaded" },
  adminRemarks: { type: String, maxlength: 1000 },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  verifiedAt: Date,
  uploadedAt: { type: Date, default: Date.now }
});
const verificationEventSchema = new Schema({
  status: { type: String, enum: ["pending", "verified", "rejected", "suspended"], required: true },
  reviewer: { type: Schema.Types.ObjectId, ref: "User", required: true },
  note: { type: String, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });
const availabilityBookingSchema = new Schema({ start: Date, end: Date }, { _id: false });
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  registrationNo: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  registrationAuthority: { type: String, trim: true, maxlength: 160 },
  specialty: { type: String, required: true, trim: true, maxlength: 120 },
  hospitalName: { type: String, trim: true, maxlength: 160 },
  qualification: { type: String, trim: true, maxlength: 200 },
  experienceYears: { type: Number, min: 0, max: 70 },
  professionalSummary: { type: String, trim: true, maxlength: 2000 },
  hospital: { type: Schema.Types.ObjectId, ref: "Hospital" },
  synthetic: { type: Boolean, default: false, index: true },
  verificationStatus: { type: String, enum: ["draft", "pending", "verified", "rejected", "suspended"], default: "verified", index: true },
  submittedAt: Date,
  verificationHistory: { type: [verificationEventSchema], default: [] },
  documents: { type: [documentSchema], default: [] },
  availability: [{
    start: Date,
    end: Date,
    booked: { type: Boolean, default: false },
    bookings: { type: [availabilityBookingSchema], default: [] }
  }]
}, { timestamps: true });
export const DoctorProfile = mongoose.models.DoctorProfile || mongoose.model("DoctorProfile", schema);
