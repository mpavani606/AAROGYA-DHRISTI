import { describe, expect, it } from "@jest/globals";
import { isCaseTransitionAllowed, isInvestigationTransitionAllowed } from "../dist/services/doctorFlowService.js";
import { requiresPathologyEvidence } from "../dist/models/Diagnosis.js";
import { Review } from "../dist/models/Review.js";

describe("Phase 7 doctor safeguards", () => {
  it("allows only role-appropriate case transitions", () => {
    expect(isCaseTransitionAllowed("submitted", "in_review", "doctor")).toBe(true);
    expect(isCaseTransitionAllowed("submitted", "clinician_reviewed", "doctor")).toBe(false);
    expect(isCaseTransitionAllowed("in_review", "clinician_reviewed", "employee")).toBe(false);
  });
  it("enforces investigation state ordering", () => {
    expect(isInvestigationTransitionAllowed("advised", "scheduled")).toBe(true);
    expect(isInvestigationTransitionAllowed("scheduled", "report_received")).toBe(false);
    expect(isInvestigationTransitionAllowed("report_received", "reviewed")).toBe(true);
  });
  it("requires reviewed pathology evidence for the malignancy category", () => {
    expect(requiresPathologyEvidence("pathology_confirmed_malignancy")).toBe(true);
    expect(requiresPathologyEvidence("clinical_suspicion")).toBe(false);
  });
  it("stores AI agreement as a review field, separately from AI inference", () => {
    expect(Review.schema.path("aiAgreement")).toBeDefined();
    expect(Review.schema.path("reviewer")).toBeDefined();
  });
});
