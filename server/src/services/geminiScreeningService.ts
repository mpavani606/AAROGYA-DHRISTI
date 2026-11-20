import { z } from "zod";
import { env } from "../config/env.js";

const observationSchema = z.object({
  imageQuality: z.enum(["adequate", "limited", "uncertain"]),
  visibleDescription: z.string().trim().min(1).max(800)
}).strict().refine(
  (value) => !/\b(cancer|malignan\w*|benign|tumou?r|diagnos\w*|precancer|carcinoma|disease|infection|healthy|normal)\b/i.test(value.visibleDescription),
  "Provider output must not contain diagnostic claims."
);

export async function assessScreeningImageWithGemini(
  image: Buffer,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  apiKey = env.GEMINI_API_KEY
) {
  if (!apiKey) throw Object.assign(new Error("Gemini is not configured."), { code: "GEMINI_NOT_CONFIGURED" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`);
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "This is a consented oral-screening image. Do not diagnose, assess cancer or disease risk, recommend treatment, or infer identity. Report only whether the image can be visually assessed and a brief neutral description of directly visible appearance. If uncertain, say so. Return JSON with imageQuality (adequate, limited, or uncertain) and visibleDescription (maximum 800 characters). State that this is an unvalidated visual observation requiring qualified clinician review." },
            { inline_data: { mime_type: mimeType, data: image.toString("base64") } }
          ]
        }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw Object.assign(new Error("Gemini screening assessment failed."), { code: "GEMINI_PROVIDER_ERROR" });
    const responseBody = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = responseBody.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    if (!text) throw Object.assign(new Error("Gemini returned no screening observation."), { code: "GEMINI_INVALID_RESPONSE" });
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw Object.assign(new Error("Gemini returned an invalid screening observation."), { code: "GEMINI_INVALID_RESPONSE" }); }
    return observationSchema.parse(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw Object.assign(new Error("Gemini screening assessment timed out."), { code: "GEMINI_TIMEOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
