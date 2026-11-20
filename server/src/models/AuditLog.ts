import mongoose, { Schema } from "mongoose";

const auditLogSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: "User" },
  action: { type: String, required: true },
  resource: String,
  resourceId: String,
  ip: String,
  userAgent: String,
  metadata: Schema.Types.Mixed
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Audit logs are append-only");
});
export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
