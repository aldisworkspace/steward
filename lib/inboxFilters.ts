export type InboxFilter =
  | "all"
  | "disallowed"
  | "needs_you"
  | "prior_approval"
  | "bookkeeper"
  | "duplicates"
  | "resolved";

export function matchesInboxFilter(
  ruleId: string | null | undefined,
  status: string,
  filter: InboxFilter,
  resolved?: boolean,
): boolean {
  if (filter === "resolved") return !!resolved;
  if (resolved) return false;
  if (filter === "all") return true;
  if (filter === "disallowed") return status === "blocked";
  if (filter === "needs_you") return status === "needs_review";
  if (filter === "prior_approval") return ruleId === "R-PRIOR-APPROVAL";
  if (filter === "bookkeeper") return ruleId === "R-GL-DISAGREE" || ruleId === "R-DEPOSIT-MISMATCH";
  if (filter === "duplicates") return ruleId === "R-DUPLICATE";
  return true;
}

export function filterLabel(f: InboxFilter): string {
  switch (f) {
    case "all":
      return "All";
    case "disallowed":
      return "Disallowed";
    case "needs_you":
      return "Needs you";
    case "prior_approval":
      return "Needs approval";
    case "bookkeeper":
      return "Bookkeeper errors";
    case "duplicates":
      return "Duplicates";
    case "resolved":
      return "Resolved";
  }
}
