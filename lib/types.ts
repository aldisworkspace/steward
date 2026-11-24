import { z } from "zod";

export const StatusZ = z.enum(["auto", "needs_review", "blocked"]);
export type Status = z.infer<typeof StatusZ>;

export const SourceZ = z.enum(["bank", "gl", "contract", "time_record", "precedent", "human", "rule", "receipt"]);
export type Source = z.infer<typeof SourceZ>;

export const GrantTermsZ = z.object({
  grantId: z.string(),
  funder: z.string(),
  program: z.string(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalAward: z.number().nonnegative(),
  budgetLines: z.array(z.object({ code: z.string(), name: z.string(), amount: z.number().nonnegative() })).min(1),
  lineVarianceLimitPct: z.number().nullable(),
  unallowable: z.array(z.object({ rule: z.string(), clauseRef: z.string() })),
  priorApproval: z.array(z.object({ rule: z.string(), thresholdUsd: z.number().nullable(), clauseRef: z.string() })),
  indirectCapPct: z.number().nullable(),
  reportDue: z.string().nullable(),
  restrictedPurpose: z.string(),
  /** How the funder is billed. Optional/nullable so terms extracted before this field still parse. */
  billing: z.object({
    frequency: z.enum(["monthly", "quarterly", "none"]),
    invoiceDueDays: z.number().int().nonnegative().nullable(),
    costBasis: z.enum(["reimbursement", "advance"]).nullable(),
  }).nullable().optional(),
  /** What indirectCapPct is a rate on: C1-style salaries, all direct costs, or modified total direct costs. */
  indirectBase: z.enum(["salaries", "direct", "mtdc"]).nullable().optional(),
  /** Contract's own receipt threshold in dollars ("receipts for every non-payroll charge of $50 or more"); null if not stated. */
  receiptThresholdUsd: z.number().nonnegative().nullable().optional(),
  /**
   * Charges the documentation clause exempts from per-payment receipts (e.g. "rent paid under the lease on file").
   * A GL line is exempt when its memo/description/account names one of documentTerms (the agreement that documents
   * it) and, when costTerms is non-empty, one of costTerms (the kind of charge). Optional; null/absent = none.
   */
  receiptExemptions: z.array(z.object({
    rule: z.string().describe("The exemption as written"),
    clauseRef: z.string(),
    costTerms: z.array(z.string()).describe("Words naming the kind of charge, e.g. [\"rent\"]; empty if any charge"),
    documentTerms: z.array(z.string()).describe("Words naming the agreement that documents it, e.g. [\"lease\"] or [\"lease\", \"service agreement\"]"),
  })).nullable().optional(),
  /**
   * The contract's explicit indirect base: budget line codes in the base (e.g. MTDC "lines A1, A2, A4") and/or lines
   * it excludes ("MTDC excludes client direct assistance (line A3)"). Optional; absent → derived from line names.
   */
  indirectBaseLines: z.array(z.string()).nullable().optional(),
  indirectExcludedLines: z.array(z.string()).nullable().optional(),
});
export type GrantTerms = z.infer<typeof GrantTermsZ>;

/** What the model may read off a receipt or invoice. Amounts are integer cents exactly as printed. */
export const ReceiptZ = z.object({
  vendor: z.string().nullable().describe("Merchant or vendor name as printed, or null"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("Purchase/invoice date as YYYY-MM-DD, or null"),
  totalCents: z.number().int().nonnegative().nullable().describe("Grand total actually printed, in integer cents ($12.34 → 1234), or null"),
  lineItems: z.array(z.object({
    description: z.string(),
    amountCents: z.number().int().describe("Printed line amount in integer cents; negative for discounts/credits"),
  })),
  purposeText: z.string().nullable().describe("Any written note about purpose or program (e.g. a handwritten 'for Literacy Lab'), or null"),
});
export type ReceiptExtract = z.infer<typeof ReceiptZ>;

/** A receipt as the pipeline sees it (matching is deterministic, see lib/matchReceipts.ts). */
export interface ReceiptRecord {
  receiptId: string;
  fileName: string;
  extracted: ReceiptExtract | null;
  matchedTxnId: string | null;
  matchScore: number | null;
  matchedBy: "auto" | "human" | null;
  /** Lines the matcher could not choose between (ties stay unmatched). */
  candidates?: string[];
}

export const EvidenceZ = z.object({ source: SourceZ, ref: z.string(), note: z.string() });
export type Evidence = z.infer<typeof EvidenceZ>;

export const DecisionCheckZ = z.object({
  ruleId: z.string().nullable(),
  label: z.string(),
  message: z.string(),
  tick: z.string(),
});
export type DecisionCheck = z.infer<typeof DecisionCheckZ>;

export const DecisionZ = z.object({
  txnId: z.string(),
  grantId: z.string().nullable(),
  budgetLine: z.string().nullable(),
  splits: z.array(z.object({ grantId: z.string().nullable(), budgetLine: z.string().nullable(), amount: z.number() })).optional(),
  status: StatusZ,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  modelRationale: z.string().optional(),
  checks: z.array(DecisionCheckZ).optional(),
  atRiskCents: z.number().optional(),
  evidence: z.array(EvidenceZ),
  ruleHits: z.array(z.string()),
});
export type Decision = z.infer<typeof DecisionZ>;

/**
 * One primary record. In GL-first workspaces this is a GL detail line (txnId "L0001", source "gl");
 * in the legacy bank-first path it is a bank transaction (txnId "T0001"). `amountCents` always uses
 * the bank convention: negative = money out / expense, positive = money in / credit.
 * A bank outflow with no GL line is kept as a placeholder with source "bank" (txnId "B0001").
 */
export interface Txn {
  txnId: string; date: string; description: string; amountCents: number; memo: string;
  source?: "gl" | "bank";
  vendor?: string;
  account?: string;
  /** Department / program / location dimension from the GL. */
  department?: string;
  /** Invoice, PO or check number. */
  docRef?: string;
  /** Transaction type as exported (e.g. "Bill", "Check", "Journal Entry"). */
  txnType?: string;
  /** The bookkeeper's coding as exported (also mirrored into glRows for the existing rules). */
  glClass?: string | null;
  glBudgetLine?: string | null;
  enteredBy?: string;
  /** Program-side sign-off (name-based until real auth). */
  programApprovedBy?: string | null;
}
/** Optional bank statement line, used only to reconcile a GL-first workspace. */
export interface BankLine { lineId: string; date: string; description: string; amountCents: number; memo: string }
export interface GlRow { bankRef: string; date: string; description: string; amountCents: number;
  account: string; class: string | null; budgetLine: string | null; enteredBy: string }
export interface StaffAllocation { employee: string; role: string; biweeklyCents: number;
  allocation: { key: string; pct: number }[] } // key: "GRANT:LINE" | "UNRESTRICTED"
export interface Precedent { id: string; date: string; by: string; ruling: string; scope: string }

export type RulingType = "allow" | "disallow" | "prior_approval_granted" | "not_duplicate";

export interface TypedPrecedent {
  id: string;
  date: string;
  by: string;
  scope: string;
  match: { txnId?: string; vendorKey?: string };
  ruling: RulingType;
  note: string;
}

/** A candidate coding of one transaction (from the GL, or proposed by the model) that rules verify. */
export interface Candidate { txnId: string; grantId: string | null; budgetLine: string | null; origin: "gl" | "model" | "none" }

export interface Finding {
  ruleId: string;
  txnId: string;
  status: Exclude<Status, "auto">;
  message: string;
  evidence: Evidence[];
  /** Suggested correction (e.g. move to unrestricted, split by effort). Never applied automatically. */
  suggestion?: { grantId: string | null; budgetLine: string | null; amountCents: number }[];
  /** Grant dollars exposed by this finding (soft rules only; see lib/softRules.ts). */
  exposureCents?: number;
}
