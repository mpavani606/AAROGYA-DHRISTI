/* global describe, test, expect */
import { decrypt, encrypt } from "../dist/services/encryption.js";
import { ageFromDateOfBirth, encryptPatientFields, normalizeName, presentPatient, similarity } from "../dist/services/patientService.js";
import { isConsentActive } from "../dist/middleware/consent.js";

describe("patient privacy and duplicate helpers", () => {
  test("AES-256-GCM encrypts and round trips", () => {
    const sealed = encrypt("Lakshmi 9876");
    expect(sealed).not.toContain("Lakshmi");
    expect(decrypt(sealed)).toBe("Lakshmi 9876");
  });
  test("normalization and similarity detect likely duplicates", () => {
    expect(normalizeName("  Sita-Ram ")).toBe("sitaram");
    expect(similarity("Sita Ram", "Sita-Ram")).toBeGreaterThan(0.9);
  });
  test("derives age from date of birth and keeps the date encrypted at rest", () => {
    expect(ageFromDateOfBirth("2000-06-15", new Date("2025-06-14T12:00:00.000Z"))).toBe(24);
    expect(ageFromDateOfBirth("2030-01-01", new Date("2025-01-01T00:00:00.000Z"))).toBeUndefined();
    const stored = encryptPatientFields({ name: "Synthetic Patient", phone: "1234567890", dateOfBirth: "2000-01-01" });
    expect(stored.ageYears).toBe(new Date().getUTCFullYear() - 2000);
    expect(stored.dateOfBirth).not.toBe("2000-01-01");
    const visible = presentPatient(stored);
    expect(visible.dateOfBirth).toBe("2000-01-01");
    expect(visible.phoneHash).toBeUndefined();
  });
  test("expired or missing consent is rejected", () => {
    expect(isConsentActive(null)).toBe(false);
    expect(isConsentActive({ granted: true, expiresAt: new Date(Date.now() - 1000) })).toBe(false);
    expect(isConsentActive({ granted: true })).toBe(true);
  });
});
