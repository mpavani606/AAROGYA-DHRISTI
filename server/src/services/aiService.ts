import sharp from "sharp";

export const AI_STATES = ["image_insufficient", "suspicious_finding_for_clinical_review", "no_suspicious_finding_by_demo_model"] as const;
export type AiState = typeof AI_STATES[number];

export type QualityThresholds = { blurMin: number; darkMax: number; glareMax: number };
export const qualityThresholds = (): QualityThresholds => ({
  blurMin: Number(process.env.AI_BLUR_MIN ?? 35),
  darkMax: Number(process.env.AI_DARK_MAX ?? 0.35),
  glareMax: Number(process.env.AI_GLARE_MAX ?? 0.12)
});

export async function qualityCheck(input: Buffer, thresholds = qualityThresholds()) {
  const image = sharp(input).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const luminance: number[] = [];
  for (let i = 0; i < data.length; i += channels) {
    luminance.push(channels >= 3 ? 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] : data[i]);
  }
  const darkPixels = luminance.filter((v) => v < 40).length;
  const glarePixels = luminance.filter((v) => v > 245).length;
  let laplacianSum = 0;
  let laplacianCount = 0;
  for (let y = 1; y < info.height - 1; y += 1) for (let x = 1; x < info.width - 1; x += 1) {
    const p = (row: number, col: number) => luminance[row * info.width + col];
    const value = p(y - 1, x) + p(y + 1, x) + p(y, x - 1) + p(y, x + 1) - 4 * p(y, x);
    laplacianSum += value * value;
    laplacianCount += 1;
  }
  const metrics = {
    blur: laplacianCount ? laplacianSum / laplacianCount : 0,
    dark: luminance.length ? darkPixels / luminance.length : 1,
    glare: luminance.length ? glarePixels / luminance.length : 1
  };
  const flags = {
    blurry: metrics.blur < thresholds.blurMin,
    dark: metrics.dark > thresholds.darkMax,
    glare: metrics.glare > thresholds.glareMax
  };
  return { pass: !Object.values(flags).some(Boolean), metrics, thresholds, flags, width: info.width, height: info.height };
}

export type DemoInferenceOptions = { state?: AiState; redFlag?: boolean; quality?: { pass?: boolean }; error?: boolean; model?: { name?: string; version?: string; license?: string; permitted_use?: string } };
export function demoInfer(options: DemoInferenceOptions = {}) {
  const model = { name: options.model?.name ?? "Aarogya Drishti Demo Model", version: options.model?.version ?? "1.0.0", license: options.model?.license ?? "Demo", permitted_use: options.model?.permitted_use ?? "Demonstration and research only" };
  const state = options.error || options.quality?.pass === false ? "image_insufficient" : options.state ?? (options.redFlag ? "suspicious_finding_for_clinical_review" : "no_suspicious_finding_by_demo_model");
  return {
    state,
    output: { label: state === "suspicious_finding_for_clinical_review" ? "REVIEW_RECOMMENDED" : state === "image_insufficient" ? "IMAGE_INSUFFICIENT" : "NO_OBVIOUS_FLAG", confidence: state === "image_insufficient" ? 0 : 0.5, confidence_note: state === "image_insufficient" ? "Image quality is insufficient for a demonstration result." : "Synthetic demonstration confidence; not clinically validated.", redFlag: state === "suspicious_finding_for_clinical_review", localization: null },
    metadata: { mode: "demo", label: "NOT FOR CLINICAL USE", model, created_at: new Date().toISOString() }
  };
}

export type RiskInput = {
  symptoms?: Array<{ name?: string; severity?: string; durationDays?: number } | string>;
  habits?: Array<{ name?: string; quantity?: number; durationYears?: number; frequency?: string } | string>;
  durationWeeks?: number;
  age?: number;
  redFlags?: string[];
  aiState?: AiState;
  tobaccoYears?: number;
  arecaDaily?: boolean;
  reverseSmoking?: boolean;
  alcoholWithTobacco?: boolean;
};
export function riskScore(input: RiskInput) {
  const reasons: Array<{ rule: string; points: number; evidence: string }> = [];
  const symptoms = (input.symptoms ?? []).map((s) => typeof s === "string" ? s.toLowerCase() : String(s.name ?? "").toLowerCase());
  const habits = (input.habits ?? []).map((h) => typeof h === "string" ? h.toLowerCase() : String(h.name ?? "").toLowerCase());
  const explicit = (input.redFlags ?? []).map((x) => x.toLowerCase());
  const flags = [...symptoms, ...explicit];
  const add = (rule: string, points: number, evidence: string) => reasons.push({ rule, points, evidence });
  if ((input.tobaccoYears ?? 0) > 10 || habits.some((x) => /tobacco|smok|chew/.test(x) && /10|long|year/.test(x))) add("tobacco_over_10_years", 15, "Tobacco use for more than 10 years was reported.");
  else if (habits.some((x) => /tobacco|smok|chew/.test(x))) add("tobacco_use", 20, "Tobacco exposure was reported.");
  if (input.arecaDaily || habits.some((x) => /areca|gutkha/.test(x) && /daily|రోజూ|रोज/.test(x))) add("areca_gutkha_daily", 10, "Daily areca or gutkha use was reported.");
  if (input.reverseSmoking || habits.some((x) => /reverse smok/.test(x))) add("reverse_smoking", 15, "Reverse smoking was reported.");
  if (input.alcoholWithTobacco || (habits.some((x) => /alcohol|drink/.test(x)) && habits.some((x) => /tobacco|smok|chew/.test(x)))) add("alcohol_regular_with_tobacco", 5, "Regular alcohol use with tobacco was reported.");
  else if (habits.some((x) => /alcohol|drink/.test(x))) add("alcohol_use", 10, "Alcohol exposure was reported.");
  if ((input.durationWeeks ?? 0) >= 2 || (input.symptoms ?? []).some((s) => typeof s !== "string" && (s.durationDays ?? 0) >= 14)) add("persistent_symptom", 20, "Symptoms persisted for more than two weeks.");
  if (flags.some((x) => /white|red patch|white patch|red patch/.test(x))) add("white_red_patch", 10, "A white or red patch was reported.");
  const legacyRedFlag = (input.symptoms ?? []).some((s) => typeof s === "string" && /ulcer|growth|bleeding/.test(s.toLowerCase()));
  if (flags.some((x) => /non.healing|ulcer|growth|bleeding/.test(x))) add(input.redFlags?.length || legacyRedFlag ? "red_flag_symptom" : "non_healing_ulcer_growth_bleeding", input.redFlags?.length || legacyRedFlag ? 50 : 20, "A non-healing ulcer, growth, or bleeding was reported.");
  if (flags.some((x) => /swallow|mouth.opening|dysphagia/.test(x))) add("swallowing_or_mouth_opening_difficulty", 15, "Swallowing or mouth-opening difficulty was reported.");
  if (input.aiState === "suspicious_finding_for_clinical_review") add("ai_suspicious_finding", 10, "The demonstration model requested clinical review.");
  if ((input.age ?? 0) >= 40) add("age_40_plus", 5, "Age is 40 or above.");
  const score = Math.min(100, reasons.reduce((sum, item) => sum + item.points, 0));
  const band = score >= 75 ? "urgent_review" : score >= 50 ? "specialist_review" : score >= 25 ? "doctor_review" : "routine_follow_up";
  return { score, band, rules: reasons, formula: "sum(points for each satisfied rule), capped at 100", redFlag: band !== "routine_follow_up" };
}
