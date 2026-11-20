import { describe, expect, it } from "@jest/globals";
import { AI_STATES, demoInfer, qualityCheck, riskScore } from "../services/aiService.js";
import { detectMime } from "../services/mediaService.js";
import { decryptBuffer, encryptBuffer } from "../services/encryption.js";
import { requiresPathologyEvidence } from "../models/Diagnosis.js";
import { patientIsAssigned } from "../middleware/patientCareRelationship.js";
import { hashIdentifier, normalizePhone } from "../services/patientService.js";
import { matchesAvailability } from "../services/appointmentBookingService.js";
import { facilityAvailability } from "../services/facilityAvailability.js";

describe("simulation safety rules", () => {
  it("normalizes common phone formatting used in patient registration", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("987-654-3210")).toBe("+919876543210");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
    expect(() => normalizePhone("abc9876543210")).toThrow("Enter a valid phone number with country code.");
  });

  it("restricts inference to the three advisory states", () => {
    expect(AI_STATES).toEqual([
      "image_insufficient",
      "suspicious_finding_for_clinical_review",
      "no_suspicious_finding_by_demo_model"
    ]);
  });

  it("never emits a finding when image quality fails", () => {
    const output = demoInfer({ redFlag: true, quality: { pass: false } });
    expect(output.state).toBe("image_insufficient");
    expect(output.output.localization).toBeNull();
    expect(output.metadata.label).toBe("NOT FOR CLINICAL USE");
  });

  it("computes repeatable quality metrics for a synthetic flat image", async () => {
    const sharp = (await import("sharp")).default;
    const flat = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#808080" } }).png().toBuffer();
    const quality = await qualityCheck(flat);
    expect(quality.metrics.blur).toBe(0);
    expect(quality.pass).toBe(false);
  });

  it("uses the demo risk-band boundaries and caps scores", () => {
    expect(riskScore({}).band).toBe("routine_follow_up");
    expect(riskScore({ tobaccoYears: 11, durationWeeks: 2, redFlags: ["ulcer"], aiState: "suspicious_finding_for_clinical_review", age: 48 }).score).toBe(100);
    expect(riskScore({ tobaccoYears: 11, durationWeeks: 2, age: 48 }).band).toBe("doctor_review");
  });

  it("requires a reviewed report only for pathology-confirmed categories", () => {
    expect(requiresPathologyEvidence("pathology_confirmed_malignancy")).toBe(true);
    expect(requiresPathologyEvidence("clinical_suspicion")).toBe(false);
  });

  it("accepts a care relationship only for the creator or matching assignment", () => {
    const user = { id: "doctor", role: "doctor", assignments: [{ mandal: "mandal-1" }] };
    expect(patientIsAssigned({ createdBy: { toString: () => "doctor" } }, user)).toBe(true);
    expect(patientIsAssigned({ mandalId: { toString: () => "mandal-1" } }, user)).toBe(true);
    expect(patientIsAssigned({ mandalId: { toString: () => "mandal-2" } }, user)).toBe(false);
    expect(patientIsAssigned({ mandal: "Paderu" }, { ...user, assignments: [{ mandal: "paderu" }] })).toBe(true);
  });

  it("allows patients to access only records matching their verified phone hash", () => {
    const patientHash = hashIdentifier("9876543210");
    const patientUser = { id: "patient-user", role: "patient", phone: "+919876543210" };
    expect(patientIsAssigned({ phoneHash: patientHash }, patientUser)).toBe(true);
    expect(patientIsAssigned({ phoneHash: hashIdentifier("9876543211") }, patientUser)).toBe(false);
  });

  it("accepts only future half-hour appointments inside an unbooked doctor schedule", () => {
    const start = new Date(Date.now() + 60 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const slot = {
      _id: { toString: () => "availability-1" },
      start: new Date(start.getTime() - 30 * 60_000),
      end: new Date(end.getTime() + 30 * 60_000),
      booked: false,
      bookings: []
    };
    expect(matchesAvailability(slot, "availability-1", start, end)).toBe(true);
    expect(matchesAvailability({ ...slot, bookings: [{ start, end }] }, "availability-1", start, end)).toBe(false);
    expect(matchesAvailability(slot, "availability-1", start, new Date(end.getTime() + 1))).toBe(false);
  });

  it("reports facility hours in the local timezone and tolerates supported schedule shapes", () => {
    const mondayMorning = new Date("2024-01-08T04:30:00.000Z");
    expect(facilityAvailability({ Monday: { start: "09:00", end: "17:00" } }, mondayMorning)).toBe("open");
    expect(facilityAvailability({ mon: "closed" }, mondayMorning)).toBe("closed");
    expect(facilityAvailability({ open: "09:00", close: "17:00" }, mondayMorning)).toBe("open");
    expect(facilityAvailability(undefined, mondayMorning)).toBe("unknown");
  });

  it("rejects declared file types without matching magic bytes", () => {
    expect(detectMime(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectMime(Buffer.from("not an image"))).toBeNull();
  });

  it("encrypts local medical media at rest and decrypts it without changing content", () => {
    const original = Buffer.from("%PDF-1.7 medical record");
    const encrypted = encryptBuffer(original);
    expect(encrypted).not.toEqual(original);
    expect(decryptBuffer(encrypted)).toEqual(original);
  });
});
