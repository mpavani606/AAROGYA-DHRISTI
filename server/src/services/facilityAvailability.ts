export type FacilityStatus = "open" | "closed" | "unknown";

type Hours = { open?: unknown; close?: unknown; closed?: unknown; status?: unknown; isOpen?: unknown };

function parseTime(value: unknown) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function parseHours(value: unknown): Hours | null {
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized === "closed") return { closed: true };
    if (normalized === "open") return { status: "open" };
    const match = /^([01]\d|2[0-3]):[0-5]\d\s*-\s*([01]\d|2[0-3]):[0-5]\d$/.exec(value.trim());
    return match ? { open: match[1], close: match[2] } : null;
  }
  if (Array.isArray(value) && value.length === 2) return { open: value[0], close: value[1] };
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return {
      open: row.open ?? row.start ?? row.opening ?? row.openTime ?? row.opensAt,
      close: row.close ?? row.end ?? row.closing ?? row.closeTime ?? row.closesAt,
      closed: row.closed,
      status: row.status,
      isOpen: row.isOpen
    };
  }
  return null;
}

export function facilityAvailability(workingHours: unknown, now = new Date()): FacilityStatus {
  if (!workingHours || typeof workingHours !== "object" || Array.isArray(workingHours)) return "unknown";
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const parts = Object.fromEntries(localParts.map((part) => [part.type, part.value]));
  const day = parts.weekday?.toLocaleLowerCase();
  if (!day) return "unknown";
  const scheduleMap = workingHours as Record<string, unknown>;
  const dayKey = Object.keys(scheduleMap).find((key) => key.toLocaleLowerCase() === day || key.toLocaleLowerCase() === day.slice(0, 3));
  const schedule = parseHours(dayKey ? scheduleMap[dayKey] : scheduleMap);
  if (!schedule) return "unknown";
  if (schedule.closed === true) return "closed";
  if (schedule.isOpen === true || schedule.status === "open") return "open";
  if (schedule.isOpen === false || schedule.status === "closed") return "closed";
  const open = parseTime(schedule.open);
  const close = parseTime(schedule.close);
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  if (open === null || close === null || open === close) return "unknown";
  return (open < close ? current >= open && current < close : current >= open || current < close) ? "open" : "closed";
}
