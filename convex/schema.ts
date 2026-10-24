import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const evidence = v.object({
  source: v.union(
    v.literal("bank"),
    v.literal("gl"),
    v.literal("contract"),
    v.literal("time_record"),
    v.literal("precedent"),
    v.literal("human"),
    v.literal("rule"),
  ),
  ref: v.string(),
  note: v.string(),
});

const grantTerms = v.object({
  grantId: v.string(),
  funder: v.string(),
  program: v.string(),
  periodStart: v.string(),
  periodEnd: v.string(),
  totalAward: v.number(),
  budgetLines: v.array(
    v.object({ code: v.string(), name: v.string(), amount: v.number() }),
  ),
  lineVarianceLimitPct: v.union(v.number(), v.null()),
  unallowable: v.array(v.object({ rule: v.string(), clauseRef: v.string() })),
  priorApproval: v.array(
    v.object({
      rule: v.string(),
      thresholdUsd: v.union(v.number(), v.null()),
      clauseRef: v.string(),
    }),
  ),
  indirectCapPct: v.union(v.number(), v.null()),
  reportDue: v.union(v.string(), v.null()),
  restrictedPurpose: v.string(),
});

export default defineSchema({
  grants: defineTable({
    grantId: v.string(),
    fileId: v.string(),
    terms: v.union(grantTerms, v.null()),
    status: v.string(),
  }).index("by_grantId", ["grantId"]),

  transactions: defineTable({
    txnId: v.string(),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    memo: v.string(),
  }).index("by_txnId", ["txnId"]),

  glRows: defineTable({
    bankRef: v.string(),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    account: v.string(),
    class: v.union(v.string(), v.null()),
    budgetLine: v.union(v.string(), v.null()),
    enteredBy: v.string(),
  }).index("by_bankRef", ["bankRef"]),

  staffAllocations: defineTable({
    employee: v.string(),
    role: v.string(),
    biweeklyCents: v.number(),
    allocation: v.array(v.object({ key: v.string(), pct: v.number() })),
  }),

  precedents: defineTable({
    date: v.string(),
    by: v.string(),
    ruling: v.string(),
    scope: v.string(),
  }),

  decisions: defineTable({
    txnId: v.string(),
    grantId: v.union(v.string(), v.null()),
    budgetLine: v.union(v.string(), v.null()),
    splits: v.optional(
      v.array(
        v.object({
          grantId: v.union(v.string(), v.null()),
          budgetLine: v.union(v.string(), v.null()),
          amount: v.number(),
        }),
      ),
    ),
    status: v.union(v.literal("auto"), v.literal("needs_review"), v.literal("blocked")),
    confidence: v.number(),
    rationale: v.string(),
    evidence: v.array(evidence),
    ruleHits: v.array(v.string()),
  }).index("by_txnId", ["txnId"]),

  proposedEntries: defineTable({
    id: v.string(),
    txnId: v.string(),
    date: v.string(),
    memo: v.string(),
    lines: v.array(
      v.object({
        account: v.string(),
        class: v.union(v.string(), v.null()),
        budgetLine: v.union(v.string(), v.null()),
        debit: v.number(),
        credit: v.number(),
      }),
    ),
    state: v.union(
      v.literal("proposed"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("posted"),
    ),
    proposedBy: v.literal("steward"),
    approvedBy: v.union(v.string(), v.null()),
  }).index("by_txnId", ["txnId"]),

  approvals: defineTable({
    entryId: v.string(),
    decision: v.string(),
    by: v.string(),
    note: v.string(),
    at: v.string(),
  }),

  auditLog: defineTable({
    at: v.string(),
    actor: v.string(),
    action: v.string(),
    targetId: v.string(),
    why: v.string(),
    evidence: v.array(v.string()),
  }),
});
