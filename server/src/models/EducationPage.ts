import mongoose, { Schema, type Types } from "mongoose";

export interface EducationPageFields {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
  slug: string;
  title_en: string;
  title_te: string;
  title_hi: string;
  body_en: string;
  body_te: string;
  body_hi: string;
  audioRef_en?: string;
  audioRef_te?: string;
  audioRef_hi?: string;
  audioCache?: Map<string, Buffer>;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  status: "draft" | "reviewed" | "published";
  seeded: boolean;
}

const schema = new Schema<EducationPageFields>({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9-]+$/ },
  title_en: { type: String, required: true, trim: true },
  title_te: { type: String, required: true, trim: true },
  title_hi: { type: String, required: true, trim: true },
  body_en: { type: String, required: true },
  body_te: { type: String, required: true },
  body_hi: { type: String, required: true },
  audioRef_en: String,
  audioRef_te: String,
  audioRef_hi: String,
  audioCache: { type: Map, of: Buffer, select: false, default: undefined },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reviewedAt: Date,
  status: { type: String, enum: ["draft", "reviewed", "published"], default: "draft", index: true },
  seeded: { type: Boolean, default: false }
}, { timestamps: true });

schema.index({ slug: 1, status: 1 });
export const EducationPage = (mongoose.models.EducationPage as mongoose.Model<EducationPageFields> | undefined)
  ?? mongoose.model<EducationPageFields>("EducationPage", schema);
