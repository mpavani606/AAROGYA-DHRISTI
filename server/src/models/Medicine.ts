import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  code: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, required: true, trim: true, maxlength: 80, index: true },
  strength: { type: String, trim: true, maxlength: 80 },
  form: { type: String, trim: true, maxlength: 80 },
  synthetic: { type: Boolean, default: false, index: true }
}, { timestamps: true });

schema.index({ name: 1, category: 1 });
export const Medicine = mongoose.models.Medicine || mongoose.model("Medicine", schema);
