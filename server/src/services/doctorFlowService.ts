import { Case } from "../models/Case.js";
import { AuditLog } from "../models/AuditLog.js";
import { Investigation, investigationStatuses } from "../models/Investigation.js";

const transitions: Record<string, { next: string[]; roles: string[] }> = {
  draft: { next: ["submitted"], roles: ["doctor"] },
  submitted: { next: ["ai_processed", "in_review"], roles: ["doctor"] },
  ai_processed: { next: ["in_review", "recapture_requested", "routine_follow_up", "specialist_review", "urgent_referral"], roles: ["doctor"] },
  in_review: { next: ["routine_follow_up", "specialist_review", "urgent_referral", "recapture_requested", "deferred", "clinician_reviewed"], roles: ["doctor"] },
  routine_follow_up: { next: ["investigation_advised", "follow_up", "closed_clinically"], roles: ["doctor"] },
  specialist_review: { next: ["investigation_advised", "follow_up"], roles: ["doctor"] },
  urgent_referral: { next: ["investigation_advised", "treatment_linked", "follow_up"], roles: ["doctor"] },
  recapture_requested: { next: ["submitted", "in_review"], roles: ["doctor"] },
  deferred: { next: ["in_review", "follow_up"], roles: ["doctor"] },
  investigation_advised: { next: ["report_received", "follow_up"], roles: ["doctor"] },
  report_received: { next: ["clinician_reviewed"], roles: ["doctor"] },
  clinician_reviewed: { next: ["specialist_review", "urgent_referral", "treatment_linked", "follow_up", "closed_clinically"], roles: ["doctor"] },
  treatment_linked: { next: ["follow_up", "closed_clinically"], roles: ["doctor"] },
  follow_up: { next: ["closed_clinically", "lost_to_follow_up"], roles: ["doctor"] },
  closed_clinically: { next: [], roles: [] },
  lost_to_follow_up: { next: ["follow_up"], roles: ["doctor"] }
};
export function isCaseTransitionAllowed(from: string, to: string, role: string) {
  const rule = transitions[from];
  return Boolean(rule?.roles.includes(role) && rule.next.includes(to));
}

export async function transitionCase(caseId: string, nextStatus: string, actor: { id: string; role: string }, metadata: Record<string, unknown> = {}) {
  const item = await Case.findById(caseId);
  if (!item) throw new Error("CASE_NOT_FOUND");
  if (!isCaseTransitionAllowed(item.status, nextStatus, actor.role)) throw new Error("INVALID_CASE_TRANSITION");
  const previous = item.status;
  item.status = nextStatus;
  await item.save();
  await AuditLog.create({ actor: actor.id, action: "case_transition", resource: "Case", resourceId: caseId, metadata: { previous, next: nextStatus, ...metadata } });
  return item;
}

const investigationTransitions: Record<string, string[]> = {
  advised: ["scheduled", "cancelled"],
  scheduled: ["collected", "cancelled"],
  collected: ["report_received", "cancelled"],
  report_received: ["reviewed"],
  reviewed: [],
  cancelled: []
};
export function isInvestigationTransitionAllowed(from: string, to: string) {
  return Boolean(investigationTransitions[from]?.includes(to));
}

export async function transitionInvestigation(id: string, nextStatus: typeof investigationStatuses[number], actor: { id: string; role: string }) {
  if (actor.role !== "doctor") throw new Error("FORBIDDEN");
  const item = await Investigation.findById(id);
  if (!item || !isInvestigationTransitionAllowed(item.status, nextStatus)) throw new Error("INVALID_INVESTIGATION_TRANSITION");
  const previous = item.status;
  item.status = nextStatus;
  const now = new Date();
  if (nextStatus === "scheduled") item.scheduledAt = now;
  if (nextStatus === "collected") item.collectedAt = now;
  if (nextStatus === "report_received") item.reportReceivedAt = now;
  if (nextStatus === "reviewed") item.reviewedAt = now;
  await item.save();
  await AuditLog.create({ actor: actor.id, action: "investigation_transition", resource: "Investigation", resourceId: id, metadata: { previous, next: nextStatus } });
  return item;
}
