import mongoose, { Schema, type Types } from "mongoose";

export interface KnowledgeChunkFields {
  _id: Types.ObjectId;
  text: string;
  language: "en" | "te" | "hi";
  sourceSlug: string;
  reviewedBy?: Types.ObjectId;
  embedding: number[];
  contentHash: string;
  sourceUpdatedAt: Date;
}

const schema = new Schema<KnowledgeChunkFields>({
  text: { type: String, required: true },
  language: { type: String, required: true, enum: ["en", "te", "hi"], index: true },
  sourceSlug: { type: String, required: true, index: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  embedding: { type: [Number], required: true, select: false },
  contentHash: { type: String, required: true },
  sourceUpdatedAt: { type: Date, required: true }
}, { timestamps: true });

schema.index({ sourceSlug: 1, language: 1, contentHash: 1 }, { unique: true });
export const KnowledgeChunk = (mongoose.models.KnowledgeChunk as mongoose.Model<KnowledgeChunkFields> | undefined)
  ?? mongoose.model<KnowledgeChunkFields>("KnowledgeChunk", schema);
