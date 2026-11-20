import { describe, expect, it } from "@jest/globals";
import { publicRealtimeCredentials } from "../controllers/assistantController.js";
import { guardAssistantResponse, safeFallback } from "../services/assistantPolicy.js";

describe("Phase 09 assistant safety and voice session contracts", () => {
  it("uses localized safe responses for diagnosis and emergency requests", () => {
    expect(safeFallback("Can you diagnose cancer?", "en", [])).toContain("cannot assess");
    expect(safeFallback("ఉపిరి ఆడటం లేదు", "te", [])).toContain("108");
    expect(safeFallback("सांस नहीं", "hi", [])).toContain("108");
  });

  it("replaces definitive diagnosis claims with a safe clinician referral", () => {
    expect(guardAssistantResponse("You do not have oral cancer.", "en")).toContain("doctor's examination");
    expect(guardAssistantResponse("మీకు క్యాన్సర్ ఉంది", "te")).toContain("వైద్యుడి పరీక్ష");
    expect(guardAssistantResponse("आपको कैंसर है", "hi")).toContain("डॉक्टर की जांच");
  });

  it("returns only short-lived voice credentials and rejects incomplete provider responses", () => {
    const credentials = publicRealtimeCredentials({ value: "temporary-session-token", expires_at: 1_800_000_000 });
    expect(credentials).toEqual({ clientSecret: "temporary-session-token", expiresAt: 1_800_000_000 });
    expect(Object.keys(credentials).sort()).toEqual(["clientSecret", "expiresAt"]);
    expect(() => publicRealtimeCredentials({ value: "missing-expiration" })).toThrow("The voice session could not be created.");
  });
});
