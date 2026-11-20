import { describe, expect, it, jest } from "@jest/globals";
import { Buffer } from "node:buffer";
import { detectMime, expiry, processUpload } from "../dist/services/mediaService.js";
import { Patient } from "../dist/models/Patient.js";
import { requirePatientCareRelationship } from "../dist/middleware/patientCareRelationship.js";

describe("medical record media controls", () => {
  it("validates file magic bytes rather than trusting the extension", async () => {
    expect(detectMime(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    await expect(processUpload(Buffer.from("not an image"), "image/png")).rejects.toMatchObject({ code: "INVALID_FILE_TYPE" });
  });

  it("creates signed URL expiry exactly five minutes ahead", () => {
    const before = Date.now() + 5 * 60 * 1000;
    const value = expiry().getTime();
    expect(value).toBeGreaterThanOrEqual(before - 20);
    expect(value).toBeLessThanOrEqual(before + 20);
  });

  it("returns 403 when a non-privileged user has no care relationship", async () => {
    const original = Patient.findById;
    Patient.findById = jest.fn(() => ({ select: async () => ({ createdBy: { toString: () => "someone-else" } }) }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await requirePatientCareRelationship({ user: { id: "requester", role: "employee" }, params: { id: "patient-1" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    Patient.findById = original;
  });
});
