import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  prompt: { type: String, required: true, maxlength: 2000 },
  sourceSlugs: { type: [String], default: [] },
  modelVersion: { type: String, required: true },
  language: { type: String, enum: ["en", "te", "hi"], required: true },
  mode: { type: String, enum: ["education", "registration"], required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const AssistantExchange = mongoose.models.AssistantExchange || mongoose.model("AssistantExchange", schema);
