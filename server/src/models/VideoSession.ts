import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  appointment: { type: Schema.Types.ObjectId, ref: "Appointment", required: true, unique: true },
  provider: { type: String, enum: ["jitsi", "daily", "mock"], required: true },
  roomName: { type: String, required: true, unique: true },
  roomUrl: { type: String },
  expiresAt: { type: Date, required: true },
  recordingEnabled: { type: Boolean, default: false },
  waitingRoom: { type: Boolean, default: true }
}, { timestamps: true });
export const VideoSession = mongoose.models.VideoSession || mongoose.model("VideoSession", schema);
