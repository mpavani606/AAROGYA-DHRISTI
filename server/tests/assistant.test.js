import { describe, expect, it } from "@jest/globals";
import { publicRealtimeCredentials } from "../dist/controllers/assistantController.js";
import { ASSISTANT_BASE_PROMPT, safeFallback, guardAssistantResponse, redactIdentifiers } from "../dist/services/assistantPolicy.js";
import { filterByRagThreshold } from "../dist/rag/search.js";

describe("Phase 11 educational assistant safeguards", () => {
  it("uses the prescribed base system prompt verbatim", () => {
    expect(ASSISTANT_BASE_PROMPT).toBe("You are an AI Oral Cancer Educational Assistant. Your responsibilities: 1. Explain oral cancer in simple language. 2. Communicate with patients naturally. 3. Support Telugu, English and Hindi. 4. Answer questions about symptoms, prevention, diagnosis and treatment. 5. Explain nutrition information. 6. Use verified medical knowledge. 7. Give short and understandable answers. 8. Allow patients to ask follow-up questions. 9. Maintain conversation context. 10. Never diagnose cancer or prescribe medicines. 11. Recommend consulting qualified doctors for medical concerns. 12. If information is unavailable, clearly say that you do not know. Your communication style: Friendly, calm, respectful and patient.");
  });

  it("redirects personal diagnosis questions and admits unknown knowledge", () => {
    expect(safeFallback("Do I have cancer?", "en", [])).toContain("doctor's examination");
    expect(safeFallback("What is an unreviewed condition?", "en", [])).toContain("I do not know");
    expect(safeFallback("Can you tell me the weather?", "en", [])).toBe("Please ask your doctor or ASHA.");
  });

  it("guards unsafe model answers and redacts identifiers from exchange prompts", () => {
    expect(guardAssistantResponse("You have cancer.", "en")).toContain("doctor's examination");
    expect(redactIdentifiers("Call me at 9876543210 about my record.")).not.toContain("9876543210");
    expect(redactIdentifiers("My ABHA number is ABHA 123456789012.")).not.toContain("123456789012");
  });

  it("returns no RAG passages when the top score is below threshold", () => {
    expect(filterByRagThreshold([
      { text: "low", language: "en", sourceSlug: "reviewed-page", score: 0.39 },
      { text: "lower", language: "en", sourceSlug: "other", score: 0.25 }
    ], 0.45)).toEqual([]);
    expect(filterByRagThreshold([
      { text: "grounded", language: "en", sourceSlug: "reviewed-page", score: 0.82 },
      { text: "below threshold", language: "en", sourceSlug: "other", score: 0.3 }
    ], 0.45)).toEqual([{ text: "grounded", sourceSlug: "reviewed-page", score: 0.82 }]);
  });

  it("projects only the ephemeral realtime secret and expiry", () => {
    expect(publicRealtimeCredentials({
      value: "ephemeral-secret",
      expires_at: 1_900_000_000,
      api_key: "server-api-key",
      model: "private-model-metadata"
    })).toEqual({ clientSecret: "ephemeral-secret", expiresAt: 1_900_000_000 });
    expect(Object.keys(publicRealtimeCredentials({ client_secret: { value: "temporary", expires_at: 1_900_000_001 } }))).toEqual(["clientSecret", "expiresAt"]);
  });
});
