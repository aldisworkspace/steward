import { z } from "zod";

export const StatusZ = z.enum(["auto", "needs_review", "blocked"]);
export type Status = z.infer<typeof StatusZ>;

export const SourceZ = z.enum(["bank", "gl", "contract", "time_record", "precedent", "human", "rule"]);
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
});
export type GrantTerms = z.infer<typeof GrantTermsZ>;

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

export interface Txn { txnId: string; date: string; description: string; amountCents: number; memo: string }
export interface GlRow { bankRef: string; date: string; description: string; amountCents: number;
  account: string; class: string | null; budgetLine: string | null; enteredBy: string }
export interface StaffAllocation { employee: string; role: string; biweeklyCents: number;
  allocation: { key: string; pct: number }[] } // key: "GRANT:LINE" | "UNRESTRICTED"
export interface Precedent { id: string; date: string; by: string; ruling: string; scope: string }

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
}
