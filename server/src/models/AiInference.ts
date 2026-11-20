import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  case: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
  image: { type: Schema.Types.ObjectId, ref: "CaseImage" },
  model: { type: Schema.Types.ObjectId, ref: "AiModel", required: true },
  state: { type: String, enum: ["image_insufficient", "suspicious_finding_for_clinical_review", "no_suspicious_finding_by_demo_model"], required: true },
  output: { type: Schema.Types.Mixed, required: true },
  metadata: { type: Schema.Types.Mixed, required: true }
}, { timestamps: true });
schema.set("strict", true);
schema.pre("save", function () { if (!this.isNew) throw new Error("AI outputs are insert-only"); });
schema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"], function () { throw new Error("AI outputs are insert-only"); });
export const AiInference = mongoose.models.AiInference || mongoose.model("AiInference", schema);
