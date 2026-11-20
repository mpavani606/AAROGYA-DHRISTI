import mongoose, { Schema } from "mongoose";
const categories = ["screen_positive_abnormality", "clinical_suspicion", "precancer", "pathology_confirmed_malignancy", "no_abnormality_clinically"] as const;
export function requiresPathologyEvidence(category: string) {
  return category === "pathology_confirmed_malignancy";
}
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  category: { type: String, enum: categories, required: true },
  enteredBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  evidenceReport: { type: Schema.Types.ObjectId, ref: "Report" },
  version: { type: Number, required: true, min: 1 }
}, { timestamps: true });
schema.index({ case: 1, version: 1 }, { unique: true });
schema.pre("validate", async function () {
  if (!requiresPathologyEvidence(this.category)) return;
  if (!this.evidenceReport) throw new Error("PATHOLOGY_EVIDENCE_REQUIRED");
  const Report = mongoose.model("Report");
  const report = await Report.findOne({ _id: this.evidenceReport, reviewedBy: { $exists: true, $ne: null } }).select("_id");
  if (!report) throw new Error("REVIEWED_PATHOLOGY_REPORT_REQUIRED");
});
export const Diagnosis = mongoose.models.Diagnosis || mongoose.model("Diagnosis", schema);
