import { env } from "../config/env.js";

export async function openAiJson<T>(path: string, body: unknown): Promise<T> {
  if (!env.OPENAI_API_KEY) throw Object.assign(new Error("AI service is not configured."), { status: 503, code: "AI_UNAVAILABLE" });
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw Object.assign(new Error("AI service request failed."), { status: response.status === 429 ? 503 : 502, code: "AI_PROVIDER_ERROR" });
  }
  return response.json() as Promise<T>;
}

export function requireOpenAiKey() {
  if (!env.OPENAI_API_KEY) throw Object.assign(new Error("AI service is not configured."), { status: 503, code: "AI_UNAVAILABLE" });
}
