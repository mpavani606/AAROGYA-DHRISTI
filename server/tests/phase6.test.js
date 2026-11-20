import { describe, expect, it } from "@jest/globals";
import sharp from "sharp";
import { demoInfer, qualityCheck, riskScore, AI_STATES } from "../dist/services/aiService.js";

describe("Phase 6 AI safeguards", () => {
  it("reports configurable dark and glare metrics", async () => {
    const dark = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    const result = await qualityCheck(dark, { blurMin: 0, darkMax: 0.1, glareMax: 1 });
    expect(result.flags.dark).toBe(true);
    const bright = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    expect((await qualityCheck(bright, { blurMin: 0, darkMax: 1, glareMax: 0.1 })).flags.glare).toBe(true);
  });
  it("accepts only documented AI states and never emits localization", () => {
    for (const state of AI_STATES) expect(demoInfer({ state }).state).toBe(state);
    expect(demoInfer({}).output).toMatchObject({ localization: null });
    expect(demoInfer({}).metadata).toMatchObject({ label: "NOT FOR CLINICAL USE", model: { name: expect.any(String), version: expect.any(String), license: expect.any(String), permitted_use: expect.any(String) }, created_at: expect.any(String) });
    expect(demoInfer({ quality: { pass: false } }).state).toBe("image_insufficient");
  });
  it.each([
    ["red flag", { symptoms: ["ulcer"] }, "red_flag_symptom"],
    ["tobacco", { habits: ["tobacco"] }, "tobacco_use"],
    ["alcohol", { habits: ["alcohol"] }, "alcohol_use"],
    ["persistence", { durationWeeks: 3 }, "persistent_symptom"],
    ["age", { age: 40 }, "age_40_plus"]
  ])("applies the %s rule transparently", (_name, input, rule) => {
    expect(riskScore(input).rules.map((item) => item.rule)).toContain(rule);
  });
  it("uses the prescribed bands and cap", () => {
    expect(riskScore({}).band).toBe("routine_follow_up");
    expect(riskScore({ redFlags: ["ulcer"] }).band).toBe("specialist_review");
    expect(riskScore({ redFlags: ["ulcer"], habits: ["tobacco", "alcohol"], age: 40, durationWeeks: 3 }).band).toBe("urgent_review");
    expect(riskScore({ redFlags: ["ulcer"], habits: ["tobacco", "alcohol"], age: 40, durationWeeks: 3 }).score).toBe(100);
  });
});
