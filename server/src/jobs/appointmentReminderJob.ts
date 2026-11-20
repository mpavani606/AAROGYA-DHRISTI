import cron from "node-cron";
import { logger } from "../services/logger.js";
import { Appointment } from "../models/Appointment.js";
import { Notification } from "../models/Notification.js";
import { renderNotification } from "../services/notificationService.js";
import { registerScheduledJob, runMonitoredJob } from "../services/jobMonitoring.js";

async function queueWindow(hours: number, template: string) {
  const start = new Date(Date.now() + (hours * 60 - 5) * 60 * 1000);
  const end = new Date(Date.now() + (hours * 60 + 5) * 60 * 1000);
  const appointments = await Appointment.find({ status: "confirmed", startAt: { $gte: start, $lte: end } });
  for (const appointment of appointments) {
    const exists = await Notification.exists({ template, "variables.appointmentId": appointment._id.toString() });
    if (exists) continue;
    const variables = { appointmentId: appointment._id.toString(), time: appointment.startAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), token: appointment.tokenNo ?? "—" };
    const message = renderNotification(template, "en", variables);
    await Notification.create({ patient: appointment.patient, user: appointment.patient, channel: "sms", template, language: "en", variables, status: "queued" });
    if (process.env.SMS_MODE !== "live") console.info(`[mock-sms] ${message}`);
  }
}

export async function evaluateAppointmentReminders() {
  await queueWindow(24, "reminder_24h");
  await queueWindow(2, "reminder_2h");
}

export function startAppointmentReminderJob() {
  registerScheduledJob("appointment-reminders", "*/5 * * * *");
  cron.schedule("*/5 * * * *", () => { void runMonitoredJob("appointment-reminders", evaluateAppointmentReminders).catch(() => logger.error("Appointment reminder failed")); });
}
