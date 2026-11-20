import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { canTransitionEducation } from "../dist/services/educationWorkflow.js";
import { educationCopyIsAllowed } from "../dist/services/educationSafety.js";

describe("Phase 10 education workflow and content safety", () => {
  it("allows only draft -> reviewed -> published transitions", () => {
    expect(canTransitionEducation("draft", "review")).toBe(true);
    expect(canTransitionEducation("reviewed", "publish")).toBe(true);
    expect(canTransitionEducation("published", "review")).toBe(false);
    expect(canTransitionEducation("draft", "publish")).toBe(false);
  });

  it("rejects prohibited patient-facing claims", () => {
    expect(educationCopyIsAllowed("This needs a doctor's examination.")).toBe(true);
    expect(educationCopyIsAllowed("You have cancer.")).toBe(false);
    expect(educationCopyIsAllowed("You do not have cancer.")).toBe(false);
    expect(educationCopyIsAllowed("This is safe and normal.")).toBe(false);
  });

  it("includes the requested education pages, diet foods and image source metadata", async () => {
    const catalog = JSON.parse(await readFile("../client/public/education/catalog.json", "utf8"));
    expect(catalog.pages.map((page) => page.slug)).toEqual(expect.arrayContaining([
      "what-is-oral-cancer", "warning-signs", "prevention", "your-visit", "recovery-care",
      "diet-nutrition", "stay-tobacco-free", "questions-for-doctor"
    ]));
    const foodNames = catalog.foods.map((food) => food.name.en);
    expect(foodNames).toEqual(expect.arrayContaining([
      "Spinach", "Amaranth leaves", "Drumstick leaves", "Gongura", "Pumpkin", "Carrot",
      "Bottle gourd", "Ridge gourd", "Tomato", "Beetroot", "Papaya", "Banana", "Mango",
      "Guava", "Orange", "Pomegranate", "Ragi", "Jowar", "Rice", "Dal and pulses",
      "Eggs", "Milk", "Curd", "Fish", "Soft-cooked chicken", "Water", "Buttermilk",
      "Coconut water", "Soup"
    ]));
    expect(catalog.foods.every((food) => food.name.en && food.name.te && food.name.hi)).toBe(true);
  });
});
