import mongoose, { Schema } from "mongoose";
const schema = new Schema({
  task: { type: Schema.Types.ObjectId, ref: "NavigatorTask", required: true, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  mode: { type: String, enum: ["community_vehicle", "108", "bike_ambulance"], required: true },
  emergency: { type: Boolean, default: false },
  status: { type: String, enum: ["requested", "accepted", "completed", "cancelled"], default: "requested" },
  notes: String
}, { timestamps: true });
export const TransportRequest = mongoose.models.TransportRequest || mongoose.model("TransportRequest", schema);
