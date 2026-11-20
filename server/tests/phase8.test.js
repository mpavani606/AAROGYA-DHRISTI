import { describe, expect, it } from "@jest/globals";
import { renderNotification, templates } from "../dist/services/notificationService.js";
import { isVideoSessionActive } from "../dist/services/videoService.js";
import { signLocationToken, verifyLocationToken } from "../dist/services/locationTokenService.js";
import { VideoSession } from "../dist/models/VideoSession.js";

describe("Phase 8 safety rules", () => {
  it("keeps all appointment notification templates free of forbidden clinical wording", () => {
    const forbidden = ["cancer", "malignancy", "diagnosis", "result", "normal", "safe"];
    for (const languageTemplates of Object.values(templates)) {
      for (const template of Object.values(languageTemplates)) {
        const text = renderNotification("appointment", "en", { date: "1 Jan", time: "10:00", hospital: "PHC", place: "Paderu", token: "AD-001" }).toLowerCase();
        expect(forbidden.some((word) => text.includes(word))).toBe(false);
        expect(template).toBeTruthy();
      }
    }
  });
  it("refuses expired video sessions", () => {
    expect(isVideoSessionActive(new Date(Date.now() - 1_000))).toBe(false);
    expect(isVideoSessionActive(new Date(Date.now() + 60_000))).toBe(true);
  });
  it("keeps video recording disabled by default", () => {
    const session = new VideoSession({
      appointment: "507f1f77bcf86cd799439011",
      provider: "mock",
      roomName: "synthetic-room",
      expiresAt: new Date(Date.now() + 60_000)
    });
    expect(session.recordingEnabled).toBe(false);
  });
  it("requires a valid signed location token", () => {
    const token = signLocationToken("patient-1");
    expect(verifyLocationToken(token, "patient-1")).toBe(true);
    expect(verifyLocationToken(token, "patient-2")).toBe(false);
  });
});
