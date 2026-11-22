import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  grants: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    grantId: v.optional(v.string()),
    terms: v.union(v.any(), v.null()),
    source: v.optional(v.union(v.literal("demo"), v.literal("upload"))),
    status: v.union(
      v.literal("uploaded"),
      v.literal("extracting"),
      v.literal("pending_confirm"),
      v.literal("ready"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
  })
    .index("by_fileName", ["fileName"])
    .index("by_grantId", ["grantId"]),

  transactions: defineTable({
    txnId: v.string(),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    memo: v.string(),
    // GL-first fields (optional so legacy bank-first rows stay valid).
    source: v.optional(v.union(v.literal("gl"), v.literal("bank"))),
    vendor: v.optional(v.string()),
    account: v.optional(v.string()),
    department: v.optional(v.string()),
    docRef: v.optional(v.string()),
    txnType: v.optional(v.string()),
    glClass: v.optional(v.union(v.string(), v.null())),
    glBudgetLine: v.optional(v.union(v.string(), v.null())),
    enteredBy: v.optional(v.string()),
    programApprovedBy: v.optional(v.union(v.string(), v.null())),
    programApprovedAt: v.optional(v.string()),
  }).index("by_txnId", ["txnId"]),

  /** Optional bank statement lines (GL-first workspaces); used only for reconciliation. */
  bankLines: defineTable({
    lineId: v.string(),
    date: v.string(),
    description: v.string(),
    amountCents: v.number(),
    memo: v.string(),
  }).index("by_lineId", ["lineId"]),

  /** Receipts / vendor invoices (PDF or image). The model reads them; matching is deterministic. */
  receipts: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    status: v.union(v.literal("uploaded"), v.literal("extracting"), v.literal("ready"), v.literal("error")),
    error: v.optional(v.string()),
    extracted: v.union(
      v.object({
        vendor: v.union(v.string(), v.null()),
        date: v.union(v.string(), v.null()),
        totalCents: v.union(v.number(), v.null()),
        lineItems: v.array(v.object({ description: v.string(), amountCents: v.number() })),
        purposeText: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
    matchedTxnId: v.union(v.string(), v.null()),
    matchScore: v.union(v.number(), v.null()),
    matchedBy: v.union(v.literal("auto"), v.literal("human"), v.null()),
    matchCandidates: v.optional(v.array(v.string())),
    matchNote: v.optional(v.string()),
  }).index("by_matchedTxnId", ["matchedTxnId"]),

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
    rulingType: v.optional(
      v.union(
        v.literal("allow"),
        v.literal("disallow"),
        v.literal("prior_approval_granted"),
        v.literal("not_duplicate"),
      ),
    ),
    matchTxnId: v.optional(v.string()),
    matchVendorKey: v.optional(v.string()),
    note: v.optional(v.string()),
  }),

  agentRunControl: defineTable({
    key: v.literal("main"),
    followUpRequested: v.boolean(),
  }).index("by_key", ["key"]),

  decisions: defineTable({
    txnId: v.string(),
    grantId: v.union(v.string(), v.null()),
    budgetLine: v.union(v.string(), v.null()),
    splits: v.optional(v.any()),
    status: v.union(v.literal("auto"), v.literal("needs_review"), v.literal("blocked")),
    confidence: v.number(),
    rationale: v.string(),
    modelRationale: v.optional(v.string()),
    checks: v.optional(v.any()),
    atRiskCents: v.optional(v.number()),
    evidence: v.any(),
    ruleHits: v.array(v.string()),
  }).index("by_txnId", ["txnId"]),

  proposedEntries: defineTable({
    id: v.string(),
    txnId: v.string(),
    date: v.string(),
    memo: v.string(),
    lines: v.any(),
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

  runs: defineTable({
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    progress: v.string(),
    usageInput: v.number(),
    usageOutput: v.number(),
    errors: v.array(v.string()),
  }),

  workspaceSettings: defineTable({
    key: v.literal("default"),
    organizationName: v.string(),
    approverName: v.string(),
    approverTitle: v.string(),
    dataSource: v.union(v.literal("demo"), v.literal("custom")),
    /** Grant-charged lines at or above this need a receipt (default $75). */
    receiptThresholdCents: v.optional(v.number()),
  }).index("by_key", ["key"]),

  inboxResolutions: defineTable({
    txnId: v.string(),
    resolution: v.union(
      v.literal("acknowledged"),
      v.literal("overridden"),
      v.literal("approved_entry"),
      v.literal("rejected_entry"),
    ),
    by: v.string(),
    at: v.string(),
    note: v.string(),
  }).index("by_txnId", ["txnId"]),
});
