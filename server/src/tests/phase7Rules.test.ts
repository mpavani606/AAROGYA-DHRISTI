import { describe, expect, it, jest } from "@jest/globals";
import { isCaseTransitionAllowed } from "../services/doctorFlowService.js";
import { isFollowUpOverdue, isFollowUpTransitionAllowed } from "../services/followUpService.js";
import { screeningCategory } from "../services/screeningService.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { queueWorkflowNotification } from "../services/workflowNotificationService.js";

describe("Phase 07 care workflow rules", () => {
  it("maps demonstration screening states to advisory categories", () => {
    expect(screeningCategory("image_insufficient")).toBe("INSUFFICIENT_IMAGE_QUALITY");
    expect(screeningCategory("no_suspicious_finding_by_demo_model")).toBe("NO_SUSPICIOUS_FEATURES_IDENTIFIED");
    expect(screeningCategory("suspicious_finding_for_clinical_review")).toBe("SUSPICIOUS_FEATURES_REQUIRE_REVIEW");
    expect(screeningCategory("unexpected")).toBe("AI_PROCESSING_UNAVAILABLE");
  });

  it("constrains follow-up status changes and marks only active past tasks overdue", () => {
    expect(isFollowUpTransitionAllowed("scheduled", "completed")).toBe(true);
    expect(isFollowUpTransitionAllowed("completed", "scheduled")).toBe(false);
    const now = new Date("2026-01-02T00:00:00.000Z");
    expect(isFollowUpOverdue("scheduled", new Date("2026-01-01T00:00:00.000Z"), now)).toBe(true);
    expect(isFollowUpOverdue("completed", new Date("2026-01-01T00:00:00.000Z"), now)).toBe(false);
  });

  it("allows referral creation after a doctor has independently reviewed a case", () => {
    expect(isCaseTransitionAllowed("clinician_reviewed", "specialist_review", "doctor")).toBe(true);
    expect(isCaseTransitionAllowed("clinician_reviewed", "urgent_referral", "doctor")).toBe(true);
    expect(isCaseTransitionAllowed("clinician_reviewed", "urgent_referral", "patient")).toBe(false);
  });

  it("keeps a care action successful when in-app notification persistence fails", async () => {
    const updateNotification = jest.spyOn(Notification, "updateOne").mockRejectedValueOnce(new Error("synthetic storage failure"));
    try {
      await expect(queueWorkflowNotification({
        eventKey: "synthetic-phase7-event",
        patientId: "synthetic-patient",
        template: "synthetic-template"
      })).resolves.toBeUndefined();
    } finally {
      updateNotification.mockRestore();
    }
  });

  it("creates only one patient notification for a patient-authored screening event", async () => {
    const actorLookup = jest.spyOn(User, "exists").mockResolvedValueOnce({ _id: "synthetic-user" } as never);
    const insertNotification = jest.spyOn(Notification, "updateOne").mockResolvedValueOnce({ acknowledged: true } as never);
    try {
      await queueWorkflowNotification({
        eventKey: "synthetic-patient-screening",
        patientId: "synthetic-patient",
        actorId: "synthetic-user",
        template: "screening_submitted"
      });
      expect(actorLookup).toHaveBeenCalledWith({ _id: "synthetic-user", role: "patient" });
      expect(insertNotification).toHaveBeenCalledTimes(1);
      expect(insertNotification.mock.calls[0]?.[0]).toEqual({ dedupeKey: "synthetic-patient-screening:patient" });
    } finally {
      actorLookup.mockRestore();
      insertNotification.mockRestore();
    }
  });
});
