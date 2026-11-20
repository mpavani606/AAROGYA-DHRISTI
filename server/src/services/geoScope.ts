import type { Request } from "express";

export const COUNT_SUPPRESSION_THRESHOLD = 5;
export const suppressedCount = (value: number): number | null => value < COUNT_SUPPRESSION_THRESHOLD ? null : value;
export const scopeFilter = (req: Request, field = "district"): Record<string, unknown> => {
  const user = req.user;
  if (!user || user.role === "system_admin") return {};
  const assignments = user.assignments ?? [];
  const values = assignments.flatMap((a) => [a[field as keyof typeof a], a.scope]).filter((v): v is string => Boolean(v));
  return values.length ? { [field]: { $in: values } } : { _id: { $in: [] } };
};
