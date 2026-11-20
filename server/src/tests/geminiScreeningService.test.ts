import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { assessScreeningImageWithGemini } from "../services/geminiScreeningService.js";

describe("consented Gemini visual screening provider", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it("sends the image only in the server-side request and validates the non-diagnostic result", async () => {
    const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ imageQuality: "adequate", visibleDescription: "A visible area of uneven coloration; clinician review is required." }) }] } }]
    }), { status: 200 }));
    const image = Buffer.from("synthetic image bytes");

    await expect(assessScreeningImageWithGemini(image, "image/jpeg", "server-test-key")).resolves.toEqual({
      imageQuality: "adequate",
      visibleDescription: "A visible area of uneven coloration; clinician review is required."
    });

    const [url, request] = fetch.mock.calls[0]!;
    expect(String(url)).not.toContain("server-test-key");
    expect(new Headers(request?.headers).get("x-goog-api-key")).toBe("server-test-key");
    expect(String(request?.body)).toContain(image.toString("base64"));
    expect(String(request?.body)).toContain("Do not diagnose");
  });

  it("rejects malformed or diagnosis-shaped provider output", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ imageQuality: "adequate", visibleDescription: "This could be cancer." }) }] } }]
    }), { status: 200 }));

    await expect(assessScreeningImageWithGemini(Buffer.from("image"), "image/jpeg", "server-test-key")).rejects.toMatchObject({ name: "ZodError" });
  });

  it("returns an explicit provider error without exposing provider response content", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private provider details", { status: 503 }));

    await expect(assessScreeningImageWithGemini(Buffer.from("image"), "image/jpeg", "server-test-key"))
      .rejects.toMatchObject({ code: "GEMINI_PROVIDER_ERROR" });
  });
});
