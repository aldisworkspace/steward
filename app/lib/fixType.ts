/**
 * Review groups exceptions by the fix a person has to make, not by the rule that fired.
 * Order is the order a reviewer should work: money that cannot be billed first.
 */
export type FixType = "not_allowed" | "receipt" | "amount" | "fund" | "approval" | "payroll";
export type ReviewFilter = FixType | "all" | "done";

export const FIX_TYPES: { id: FixType; label: string; verb: string }[] = [
  { id: "not_allowed", label: "Not allowed", verb: "Move off the grant" },
  { id: "receipt", label: "Attach receipt", verb: "Attach receipt" },
  { id: "amount", label: "Fix the amount", verb: "Fix the amount" },
  { id: "fund", label: "Move to another fund", verb: "Confirm the fund" },
  { id: "approval", label: "Funder approval", verb: "Record approval" },
  { id: "payroll", label: "Payroll", verb: "Check the time sheet" },
];

const RECEIPT = new Set(["R-RECEIPT-MISSING", "R-RECEIPT-AMBIGUOUS", "R-NEEDS-DOCS"]);
const AMOUNT = new Set([
  "R-RECEIPT-MISMATCH",
  "R-AMOUNT-MISMATCH",
  "R-DEPOSIT-MISMATCH",
  "R-DUPLICATE",
  "R-BANK-UNRECORDED",
  "R-GL-NO-BANK",
  "R-GL-ORPHAN",
]);
const APPROVAL = new Set(["R-PRIOR-APPROVAL", "R-LINE-OVERRUN"]);

export function fixTypeOf(ruleId: string | null | undefined, status: string): FixType {
  if (status === "blocked" || ruleId === "R-PERIOD") return "not_allowed";
  if (ruleId && RECEIPT.has(ruleId)) return "receipt";
  if (ruleId && AMOUNT.has(ruleId)) return "amount";
  if (ruleId && APPROVAL.has(ruleId)) return "approval";
  if (ruleId === "R-EFFORT") return "payroll";
  return "fund";
}

export function fixTypeLabel(id: ReviewFilter): string {
  if (id === "all") return "All";
  if (id === "done") return "Done";
  return FIX_TYPES.find((f) => f.id === id)?.label ?? id;
}
