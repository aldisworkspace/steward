/**
 * "Soft" findings: reconciliation and documentation gaps. They always mean needs_review (never
 * blocked), they don't stop the model's own concern from being recorded, and their at-risk
 * amount comes from the finding's `exposureCents` (e.g. only the difference for a mismatch).
 */
export const SOFT_RULES = new Set([
  "R-BANK-UNRECORDED",
  "R-GL-NO-BANK",
  "R-AMOUNT-MISMATCH",
  "R-RECEIPT-MISSING",
  "R-RECEIPT-MISMATCH",
  "R-RECEIPT-AMBIGUOUS",
  "R-PURPOSE-UNCLEAR",
]);

export const isSoftRule = (ruleId: string) => SOFT_RULES.has(ruleId);
