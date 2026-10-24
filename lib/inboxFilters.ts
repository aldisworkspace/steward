export type InboxFilter =
  | "all"
  | "not_allowed"
  | "needs_you"
  | "approval"
  | "payroll"
  | "books"
  | "duplicate"
  | "other"
  | "done";

export type InboxCategory =
  | "not_allowed"
  | "approval"
  | "payroll"
  | "books"
  | "duplicate"
  | "other";

export function inboxCategory(
  ruleId: string | null | undefined,
  status: string,
): InboxCategory {
  if (status === "blocked" || ruleId?.startsWith("R-UNALLOWABLE") || ruleId === "R-PERIOD") {
    return "not_allowed";
  }
  if (ruleId === "R-PRIOR-APPROVAL" || ruleId === "R-LINE-OVERRUN") return "approval";
  if (ruleId === "R-EFFORT") return "payroll";
  if (ruleId === "R-GL-DISAGREE" || ruleId === "R-DEPOSIT-MISMATCH" || ruleId === "R-GL-ORPHAN") {
    return "books";
  }
  if (ruleId === "R-DUPLICATE") return "duplicate";
  return "other";
}

export function matchesInboxFilter(
  ruleId: string | null | undefined,
  status: string,
  filter: InboxFilter,
  resolved?: boolean,
): boolean {
  if (filter === "done") return !!resolved;
  if (resolved) return false;
  if (filter === "all") return true;
  if (filter === "needs_you") {
    if (status === "auto") return false;
    return inboxCategory(ruleId, status) !== "not_allowed";
  }
  const cat = inboxCategory(ruleId, status);
  if (filter === "not_allowed") return cat === "not_allowed";
  if (filter === "approval") return cat === "approval";
  if (filter === "payroll") return cat === "payroll";
  if (filter === "books") return cat === "books";
  if (filter === "duplicate") return cat === "duplicate";
  if (filter === "other") return cat === "other";
  return true;
}

export function filterLabel(f: InboxFilter): string {
  switch (f) {
    case "all":
      return "All";
    case "not_allowed":
      return "Not allowed";
    case "needs_you":
      return "Needs you";
    case "approval":
      return "Funder approval";
    case "payroll":
      return "Payroll";
    case "books":
      return "Books don't match";
    case "duplicate":
      return "Duplicates";
    case "other":
      return "Other";
    case "done":
      return "Done";
  }
}

export const PRIMARY_FILTERS: InboxFilter[] = ["all", "not_allowed", "approval", "payroll"];
export const MORE_FILTERS: InboxFilter[] = ["books", "duplicate", "other", "done"];
