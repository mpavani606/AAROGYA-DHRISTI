import cron from "node-cron";
import { logger } from "../services/logger.js";
import { Case } from "../models/Case.js";
import { SlaRule } from "../models/SlaRule.js";
import { Task } from "../models/Task.js";
import { AuditLog } from "../models/AuditLog.js";
import { registerScheduledJob, runMonitoredJob } from "../services/jobMonitoring.js";

const defaultRules = [
  { stage: "in_review", priorityBand: "routine_follow_up", targetHours: 48, escalateTo: "navigator" },
  { stage: "in_review", priorityBand: "urgent_referral", targetHours: 4, escalateTo: "doctor" },
  { stage: "specialist_review", priorityBand: "routine_follow_up", targetHours: 168, escalateTo: "navigator" },
  { stage: "specialist_review", priorityBand: "urgent_referral", targetHours: 48, escalateTo: "doctor" },
  { stage: "investigation_advised", targetHours: 336, escalateTo: "navigator" },
  { stage: "treatment_linked", targetHours: 336, escalateTo: "navigator" }
];

export async function evaluateSlaEscalations(now = new Date()) {
  await SlaRule.bulkWrite(defaultRules.map((rule) => ({ updateOne: { filter: { stage: rule.stage, priorityBand: rule.priorityBand }, update: { $setOnInsert: rule }, upsert: true } })));
  const rules = await SlaRule.find();
  let created = 0;
  for (const rule of rules) {
    const threshold = new Date(now.getTime() - rule.targetHours * 60 * 60 * 1000);
    const cases = await Case.find({ status: rule.stage, ...(rule.priorityBand ? { priorityBand: rule.priorityBand } : {}), updatedAt: { $lte: threshold } }).select("_id patient");
    for (const item of cases) {
      const exists = await Task.exists({ case: item._id, type: "sla-escalation", "details.stage": rule.stage, status: "open" });
      if (exists) continue;
      await Task.create({ case: item._id, patient: item.patient, type: "sla-escalation", status: "open", source: "manual", details: { stage: rule.stage, escalateTo: rule.escalateTo, createdAt: now } });
      await AuditLog.create({ action: "sla_escalation", resource: "Case", resourceId: item._id.toString(), metadata: { stage: rule.stage, escalateTo: rule.escalateTo } });
      created += 1;
    }
  }
  return created;
}

export function startSlaJob() {
  registerScheduledJob("sla-escalations", "0 * * * *");
  cron.schedule("0 * * * *", () => { void runMonitoredJob("sla-escalations", evaluateSlaEscalations).catch(() => logger.error("SLA evaluation failed")); });
}
