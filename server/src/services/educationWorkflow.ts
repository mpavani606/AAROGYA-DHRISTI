export function canTransitionEducation(status: string, action: "review" | "publish") {
  return action === "review" ? status === "draft" : status === "reviewed";
}
