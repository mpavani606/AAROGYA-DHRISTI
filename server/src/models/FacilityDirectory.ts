import mongoose, { Schema } from "mongoose";

const sourceSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  document: { type: String, trim: true, maxlength: 255 },
  snapshotDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
  url: { type: String, trim: true, maxlength: 500 },
  verifiedOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
  importedAt: { type: Date, required: true }
}, { _id: false });

const facilitySchema = new Schema({
  sourceKey: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
  normalizedKey: { type: String, required: true, unique: true, trim: true, maxlength: 240 },
  name: { type: String, required: true, trim: true, maxlength: 180, index: true },
  facilityType: { type: String, required: true, enum: ["PHC", "CHC", "Area Hospital", "District Hospital"] },
  hospitalCode: { type: String, trim: true, maxlength: 80, default: null },
  district: { type: String, required: true, trim: true, maxlength: 100, index: true },
  mandal: { type: String, required: true, trim: true, maxlength: 100, index: true },
  address: { type: String, trim: true, maxlength: 300, default: null },
  contactNumber: { type: String, trim: true, maxlength: 40, default: null },
  email: { type: String, trim: true, maxlength: 254, default: null },
  beds: { type: Number, min: 0, default: null },
  sourceSerial: { type: Number, min: 1, default: null },
  source: { type: sourceSchema, required: true }
}, { timestamps: true });

facilitySchema.index({ district: 1, mandal: 1, facilityType: 1, name: 1 });
facilitySchema.index({ name: "text", hospitalCode: "text", district: "text", mandal: "text", address: "text", contactNumber: "text", email: "text" });

const doctorSchema = new Schema({
  sourceKey: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
  hospitalId: { type: Schema.Types.ObjectId, ref: "FacilityDirectory", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160, index: true },
  role: { type: String, required: true, enum: ["Medical Officer / Contact Person"] },
  specialization: { type: String, trim: true, maxlength: 120, default: null },
  registrationNumber: { type: String, trim: true, maxlength: 100, default: null },
  hprId: { type: String, trim: true, maxlength: 100, default: null },
  mobile: { type: String, trim: true, maxlength: 40, default: null },
  email: { type: String, trim: true, maxlength: 254, default: null },
  district: { type: String, required: true, trim: true, maxlength: 100, index: true },
  mandal: { type: String, required: true, trim: true, maxlength: 100, index: true },
  source: { type: sourceSchema, required: true }
}, { timestamps: true });

doctorSchema.index({ hospitalId: 1, name: 1 });
doctorSchema.index({ name: "text", specialization: "text", registrationNumber: "text", hprId: "text", mobile: "text", email: "text", district: "text", mandal: "text" });

export const FacilityDirectory = mongoose.models.FacilityDirectory || mongoose.model("FacilityDirectory", facilitySchema);
export const DirectoryDoctor = mongoose.models.DirectoryDoctor || mongoose.model("DirectoryDoctor", doctorSchema);
