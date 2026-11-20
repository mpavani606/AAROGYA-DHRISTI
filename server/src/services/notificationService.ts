import { Notification } from "../models/Notification.js";

const templates: Record<string, Record<string, string>> = {
  appointment: {
    en: "You have a health appointment on {date}, {time} at {hospital}, {place}. Token {token}.",
    te: "{date}, {time} కు {hospital}, {place} వద్ద మీ ఆరోగ్య అపాయింట్‌మెంట్ ఉంది. టోకెన్ {token}.",
    hi: "{date}, {time} को {hospital}, {place} पर आपकी स्वास्थ्य अपॉइंटमेंट है। टोकन {token}।"
  },
  reminder_24h: {
    en: "Reminder: you have a health appointment tomorrow at {time}. Token {token}.",
    te: "రిమైండర్: రేపు {time} కు మీ ఆరోగ్య అపాయింట్‌మెంట్ ఉంది. టోకెన్ {token}.",
    hi: "रिमाइंडर: कल {time} पर आपकी स्वास्थ्य अपॉइंटमेंट है। टोकन {token}।"
  },
  reminder_2h: {
    en: "Reminder: your health appointment is at {time}. Token {token}.",
    te: "రిమైండర్: మీ ఆరోగ్య అపాయింట్‌మెంట్ {time} కు ఉంది. టోకెన్ {token}.",
    hi: "रिमाइंडर: आपकी स्वास्थ्य अपॉइंटमेंट {time} पर है। टोकन {token}।"
  }
};

export function renderNotification(template: string, language: string, variables: Record<string, string | number>) {
  const source = templates[template]?.[language] ?? templates.appointment.en;
  return source.replace(/\{(\w+)\}/g, (_match, key: string) => String(variables[key] ?? ""));
}

export async function queueAppointmentNotifications(appointment: { patient: string; clinician: string; tokenNo?: string; startAt: Date; hospital?: string }, template = "appointment") {
  const variables = { date: appointment.startAt.toLocaleDateString("en-IN"), time: appointment.startAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), hospital: appointment.hospital ?? "designated centre", place: "please check your appointment details", token: appointment.tokenNo ?? "—" };
  const rows = [
    { patient: appointment.patient, user: appointment.patient, channel: "inapp" as const },
    { patient: appointment.patient, user: appointment.clinician, channel: "inapp" as const },
  ];
  return Notification.insertMany(rows.flatMap((row) => (["en", "te", "hi"] as const).slice(0, 1).map((language) => ({ ...row, template, language, variables, status: "queued" }))));
}

export { templates };
