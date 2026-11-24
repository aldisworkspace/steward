/** Plain-English labels for billing packages. Display only; numbers come from lib/tieOut. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type PackageStatus = "draft" | "ready_for_review" | "signed" | "exported";

export type PackageSummary = {
  grantId: string;
  program: string;
  funder: string;
  periodStart: string;
  periodEnd: string;
  packageId: string | null;
  status: PackageStatus;
  invoiceNo: string;
  preparedBy: string | null;
  reviewedBy: string | null;
  signedAt: string | null;
  invoiceTotalCents: number;
  lineCount: number;
  excludedCount: number;
  checksPassed: number;
  checksTotal: number;
  failing: string[];
  frequency?: string;
  dueDate?: string | null;
};

function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

export function shortDate(iso: string, withYear = false) {
  const { y, m, d } = parts(iso);
  return `${SHORT[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "October 2026" for a calendar month, otherwise "Jun 1, 2026 – May 31, 2027". */
export function periodLabel(start: string, end: string) {
  const a = parts(start);
  const b = parts(end);
  const lastDay = new Date(Date.UTC(b.y, b.m, 0)).getUTCDate();
  if (a.y === b.y && a.m === b.m && a.d === 1 && b.d === lastDay) return `${MONTHS[a.m - 1]} ${a.y}`;
  return `${shortDate(start, true)} – ${shortDate(end, true)}`;
}

export function monthName(start: string) {
  return MONTHS[parts(start).m - 1]!;
}

/** Days from today (local calendar) to an ISO date; negative = past. */
export function daysUntil(iso: string, nowMs: number) {
  const { y, m, d } = parts(iso);
  const now = new Date(nowMs);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
}

export function dueLabel(dueDate: string | null | undefined, nowMs: number): { text: string; overdue: boolean; days: number | null } {
  if (!dueDate || !nowMs) return { text: dueDate ? `Due ${shortDate(dueDate, true)}` : "No due date in the terms", overdue: false, days: null };
  const days = daysUntil(dueDate, nowMs);
  if (days < 0) return { text: `Overdue by ${days === -1 ? "1 day" : `${-days} days`}`, overdue: true, days };
  if (days === 0) return { text: "Due today", overdue: false, days };
  return { text: `Due in ${days === 1 ? "1 day" : `${days} days`}`, overdue: false, days };
}

export function statusWord(p: Pick<PackageSummary, "status" | "failing">): { text: string; tone: "neutral" | "amber" | "green" | "ink" } {
  if (p.status === "exported") return { text: "Exported", tone: "neutral" };
  if (p.status === "signed") return { text: "Signed", tone: "green" };
  const n = p.failing.length;
  if (p.status === "ready_for_review") {
    return n ? { text: `Ready for review · ${n} ${n === 1 ? "check fails" : "checks fail"}`, tone: "amber" } : { text: "Ready for review", tone: "green" };
  }
  return n ? { text: `Needs ${n} ${n === 1 ? "fix" : "fixes"}`, tone: "amber" } : { text: "Draft · all checks pass", tone: "neutral" };
}

export const CHECK_ORDER = [
  "SUM_TIES",
  "INDIRECT_ROUNDING",
  "CUMULATIVE_WITHIN_BUDGET",
  "IN_PERIOD",
  "RECEIPTS",
  "NO_OPEN_EXCEPTIONS",
  "PROGRAM_APPROVAL",
] as const;

/** One plain sentence per tie-out check, said the way a reviewer would. */
export function checkTitle(id: string, pass: boolean, numbers: Record<string, number>): string {
  const n = (k: string) => numbers[k] ?? 0;
  switch (id) {
    case "SUM_TIES":
      return pass ? "Invoice, expenditure report and ledger agree" : "Invoice, expenditure report and ledger disagree";
    case "INDIRECT_ROUNDING":
      return pass ? "Indirect is computed once, to the cent" : "Indirect on the invoice doesn't match the rate";
    case "CUMULATIVE_WITHIN_BUDGET":
      return pass ? "Every line is within its budget to date" : "A budget line is over its cap to date";
    case "IN_PERIOD":
      return pass ? "Every charge falls in the billing period" : `${n("outOfPeriod")} ${n("outOfPeriod") === 1 ? "charge falls" : "charges fall"} outside the period`;
    case "RECEIPTS":
      return pass ? "Every charge over the threshold has a receipt" : `${n("missing")} ${n("missing") === 1 ? "charge needs" : "charges need"} a receipt`;
    case "NO_OPEN_EXCEPTIONS":
      return pass ? "No open exceptions" : `${n("open")} ${n("open") === 1 ? "exception is" : "exceptions are"} still open`;
    case "PROGRAM_APPROVAL":
      return pass ? "Program staff approved every line" : `${n("unapproved")} ${n("unapproved") === 1 ? "line needs" : "lines need"} program approval`;
    default:
      return id;
  }
}

/** Line ids a failing check names in its detail (L0012, T0034, B0003). */
export function idsInDetail(detail: string): string[] {
  return [...new Set(detail.match(/\b[LTB]\d{3,}\b/g) ?? [])];
}
