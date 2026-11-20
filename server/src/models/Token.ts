import mongoose, { Schema } from "mongoose";
const schema = new Schema({ token: { type: String, unique: true, required: true }, patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true }, clientUuid: { type: String, sparse: true, unique: true }, mandal: String, year: Number, sequence: Number }, { timestamps: true });
export const Token = mongoose.models.Token || mongoose.model("Token", schema);
