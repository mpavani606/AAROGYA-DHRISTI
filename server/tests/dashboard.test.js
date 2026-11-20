import { describe, expect, it } from "@jest/globals";
import { dashboardCsv, median, rate, suppressedCount } from "../dist/services/dashboardService.js";
import { hasRequiredRole } from "../dist/middleware/rbac.js";

describe("district dashboard aggregate rules", () => {
  const syntheticPatients = Array.from({ length: 40 }, (_, index) => ({
    syntheticId: `demo-${index + 1}`,
    mandal: `mandal-${index % 11}`,
    eligible: index < 32,
    screened: index < 20
  }));

  it("calculates screening coverage from 40 synthetic patients across 11 mandals", () => {
    expect(new Set(syntheticPatients.map((patient) => patient.mandal)).size).toBe(11);
    const eligible = syntheticPatients.filter((patient) => patient.eligible).length;
    const screened = new Set(syntheticPatients.filter((patient) => patient.eligible && patient.screened).map((patient) => patient.syntheticId)).size;
    expect(eligible).toBe(32);
    expect(screened).toBe(20);
    expect(rate(screened, eligible)).toBe(62.5);
  });

  it("returns medians and suppresses village counts below five", () => {
    expect(median([48, 12, 24])).toBe(24);
    expect(median([1, 3, 5, 9])).toBe(4);
    expect(suppressedCount(0)).toBe("<5");
    expect(suppressedCount(4)).toBe("<5");
    expect(suppressedCount(5)).toBe(5);
  });

  it("allows only district and system administrators through the dashboard role gate", () => {
    expect(hasRequiredRole("district_admin", ["district_admin", "system_admin"])).toBe(true);
    expect(hasRequiredRole("system_admin", ["district_admin", "system_admin"])).toBe(true);
    expect(hasRequiredRole("doctor", ["district_admin", "system_admin"])).toBe(false);
    expect(hasRequiredRole("patient", ["district_admin", "system_admin"])).toBe(false);
  });

  it("serializes only aggregate numeric values for CSV exports", () => {
    const csv = dashboardCsv({
      screeningCoverage: 62.5,
      screenedAdults: 20,
      patientName: "Synthetic Example",
      phone: "0000000000",
      metricNotes: { screeningCoverage: "note" }
    });
    expect(csv).toContain("screeningCoverage,62.5");
    expect(csv).not.toContain("Synthetic Example");
    expect(csv).not.toContain("0000000000");
    expect(csv).not.toContain("patientName");
  });
});
