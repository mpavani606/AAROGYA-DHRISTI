import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
  clientUuid: { type: String, sparse: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  frequency: { type: String, maxlength: 80 },
  quantity: { type: Number, min: 0 },
  unit: { type: String, maxlength: 40 },
  startedAt: Date,
  stoppedAt: Date,
  notes: { type: String, maxlength: 2000 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });
export const Habit = mongoose.models.Habit || mongoose.model("Habit", schema);
