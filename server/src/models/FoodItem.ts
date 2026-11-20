import mongoose, { Schema, type Types } from "mongoose";

export interface FoodItemFields {
  _id: Types.ObjectId;
  key: string;
  name_en: string;
  name_te: string;
  name_hi: string;
  imageUrl: string;
  category: "leafy_greens" | "vegetables_fruits" | "grains" | "protein" | "fluids" | "careful";
  suitabilityNote: Record<string, string>;
  license: string;
  source: string;
  author: string;
}

const schema = new Schema<FoodItemFields>({
  key: { type: String, required: true, unique: true },
  name_en: { type: String, required: true },
  name_te: { type: String, required: true },
  name_hi: { type: String, required: true },
  imageUrl: { type: String, required: true },
  category: { type: String, enum: ["leafy_greens", "vegetables_fruits", "grains", "protein", "fluids", "careful"], required: true },
  suitabilityNote: { type: Schema.Types.Mixed, required: true },
  license: { type: String, required: true },
  source: { type: String, required: true },
  author: { type: String, required: true }
}, { timestamps: true });

export const FoodItem = (mongoose.models.FoodItem as mongoose.Model<FoodItemFields> | undefined)
  ?? mongoose.model<FoodItemFields>("FoodItem", schema);
