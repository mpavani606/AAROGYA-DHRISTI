import { describe, expect, it } from "@jest/globals";
import { COUNT_SUPPRESSION_THRESHOLD, suppressedCount, scopeFilter } from "../dist/services/geoScope.js";

describe("geography privacy controls", () => {
  it("suppresses counts below five", () => {
    expect(COUNT_SUPPRESSION_THRESHOLD).toBe(5);
    expect(suppressedCount(4)).toBeNull();
    expect(suppressedCount(5)).toBe(5);
  });
  it("scopes non-system users to assignments", () => {
    expect(scopeFilter({ user: { role: "district_admin", assignments: [{ district: "district-1" }] } })).toEqual({ district: { $in: ["district-1"] } });
    expect(scopeFilter({ user: { role: "system_admin", assignments: [] } })).toEqual({});
  });
});
