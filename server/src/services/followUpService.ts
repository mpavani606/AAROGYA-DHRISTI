const transitions: Record<string, string[]> = {
  pending: ["scheduled", "cancelled"],
  scheduled: ["completed", "missed", "rescheduled", "cancelled"],
  missed: ["scheduled", "rescheduled", "cancelled"],
  rescheduled: ["completed", "missed", "rescheduled", "cancelled"],
  completed: [],
  cancelled: []
};

export const isFollowUpTransitionAllowed = (from: string, to: string) => Boolean(transitions[from]?.includes(to));
export const isFollowUpOverdue = (status: string, scheduledAt: Date, now = new Date()) =>
  ["pending", "scheduled", "rescheduled"].includes(status) && scheduledAt < now;
