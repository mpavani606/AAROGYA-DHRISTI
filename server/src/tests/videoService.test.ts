import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createDailyMeetingToken, createDailyRoom } from "../services/videoService.js";

const originalApiKey = process.env.DAILY_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.DAILY_API_KEY;
  else process.env.DAILY_API_KEY = originalApiKey;
  jest.restoreAllMocks();
});

describe("Daily video provider", () => {
  it("creates private rooms with recording disabled and chat enabled", async () => {
    process.env.DAILY_API_KEY = "test-daily-api-key";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      name: "aarogya-test",
      url: "https://example.daily.co/aarogya-test"
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(createDailyRoom("aarogya-test", new Date(Date.now() + 60_000))).resolves.toEqual({
      name: "aarogya-test",
      url: "https://example.daily.co/aarogya-test"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.daily.co/v1/rooms", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-daily-api-key" }),
      body: expect.stringContaining('"privacy":"private"')
    }));
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('"enable_recording":"off"');
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('"enable_chat":true');
  });

  it("issues appointment-scoped participant tokens", async () => {
    process.env.DAILY_API_KEY = "test-daily-api-key";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "short-lived-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const expiresAt = new Date(Date.now() + 60_000);

    await expect(createDailyMeetingToken("aarogya-test", expiresAt, "patient-id", "Patient", false)).resolves.toBe("short-lived-token");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { properties: Record<string, unknown> };
    expect(requestBody.properties).toMatchObject({
      room_name: "aarogya-test",
      user_id: "patient-id",
      user_name: "Patient",
      is_owner: false,
      eject_at_token_exp: true
    });
  });

  it("fails explicitly when the server key is not configured", async () => {
    process.env.DAILY_API_KEY = "";
    await expect(createDailyRoom("aarogya-test", new Date(Date.now() + 60_000)))
      .rejects.toMatchObject({ status: 503, code: "VIDEO_PROVIDER_NOT_CONFIGURED" });
  });
});
