import { readFile } from "node:fs/promises";
import { FoodItem } from "../models/FoodItem.js";
import { EducationPage } from "../models/EducationPage.js";

type Language = "en" | "te" | "hi";
type Catalog = {
  pages: Array<{ slug: string; title: Record<Language, string>; body: Record<Language, string> }>;
  foods: Array<{ id: string; name: Record<Language, string>; category: string }>;
  softFoodTip: Record<Language, string>;
};

const imageByCategory: Record<string, string> = {
  leafy_greens: "/education/images/leafy-greens.svg",
  vegetables_fruits: "/education/images/produce.svg",
  grains: "/education/images/grains.svg",
  protein: "/education/images/protein.svg",
  fluids: "/education/images/fluids.svg",
  careful: "/education/images/careful.svg"
};
const cautions: Record<Language, string> = {
  en: "Some people find softer textures more comfortable. Ask your care team for advice suited to you.",
  te: "కొంతమందికి మెత్తని ఆహారం సౌకర్యంగా ఉంటుంది. మీకు సరిపోయే సలహా కోసం సంరక్షణ బృందాన్ని అడగండి.",
  hi: "कुछ लोगों को नरम बनावट आरामदायक लगती है। अपने लिए सलाह देखभाल टीम से लें।"
};

export async function seedEducation() {
  const catalogUrl = new URL("../../../client/public/education/catalog.json", import.meta.url);
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8")) as Catalog;
  for (const page of catalog.pages) {
    await EducationPage.updateOne({ slug: page.slug }, {
      $setOnInsert: {
        slug: page.slug,
        title_en: page.title.en, title_te: page.title.te, title_hi: page.title.hi,
        body_en: page.body.en, body_te: page.body.te, body_hi: page.body.hi,
        status: "draft", seeded: true
      }
    }, { upsert: true });
  }
  for (const food of catalog.foods) {
    await FoodItem.updateOne({ key: food.id }, {
      $set: {
        key: food.id,
        name_en: food.name.en, name_te: food.name.te, name_hi: food.name.hi,
        imageUrl: imageByCategory[food.category],
        category: food.category,
        suitabilityNote: food.category === "careful" ? cautions : catalog.softFoodTip,
        license: "CC0; self-created decorative illustration",
        source: "Locally authored category illustration in client/public/education/images",
        author: "Aarogya Drishti project team"
      }
    }, { upsert: true });
  }
}
