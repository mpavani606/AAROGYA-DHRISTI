import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { logger } from "./logger.js";

type WorkflowNotification = {
  eventKey: string;
  patientId: string;
  actorId?: string;
  template: string;
};

export async function queueWorkflowNotification(input: WorkflowNotification) {
  try {
    const actorIsPatient = input.actorId
      ? await User.exists({ _id: input.actorId, role: "patient" })
      : false;
    const recipients = [
      { recipient: "patient", user: undefined },
      ...(input.actorId && input.actorId !== input.patientId && !actorIsPatient ? [{ recipient: input.actorId, user: input.actorId }] : [])
    ];
    for (const recipient of recipients) {
      const dedupeKey = `${input.eventKey}:${recipient.recipient}`;
      await Notification.updateOne(
        { dedupeKey },
        { $setOnInsert: {
          patient: input.patientId,
          ...(recipient.user ? { user: recipient.user } : {}),
          channel: "inapp",
          template: input.template,
          language: "en",
          variables: {},
          status: "sent",
          sentAt: new Date(),
          dedupeKey
        } },
        { upsert: true }
      );
    }
  } catch (error) {
    logger.error({ code: error instanceof Error ? error.name : "NOTIFICATION_ERROR" }, "Workflow notification could not be queued");
  }
}

export async function queuePatientNotification(input: { eventKey: string; patientId: string; template: string }) {
  const dedupeKey = `${input.eventKey}:patient`;
  await Notification.updateOne(
    { dedupeKey },
    { $setOnInsert: {
      patient: input.patientId,
      channel: "inapp",
      template: input.template,
      language: "en",
      variables: {},
      status: "sent",
      sentAt: new Date(),
      dedupeKey
    } },
    { upsert: true }
  );
}
