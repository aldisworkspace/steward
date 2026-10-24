import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Decision, GlRow, GrantTerms, Precedent, StaffAllocation, Txn } from "../lib/types";

export const getGrant = internalQuery({
  args: { grantDocId: v.id("grants") },
  handler: async (ctx, { grantDocId }) => ctx.db.get(grantDocId),
});

export const setGrantExtracting = internalMutation({
  args: { grantDocId: v.id("grants") },
  handler: async (ctx, { grantDocId }) => {
    await ctx.db.patch(grantDocId, { status: "extracting", error: undefined });
  },
});

export const setGrantReady = internalMutation({
  args: { grantDocId: v.id("grants"), terms: v.any(), fileName: v.string() },
  handler: async (ctx, { grantDocId, terms, fileName }) => {
    const t = terms as GrantTerms;
    await ctx.db.patch(grantDocId, {
      status: "ready",
      terms,
      grantId: t.grantId,
      error: undefined,
    });
    await ctx.db.insert("auditLog", {
      at: new Date().toISOString(),
      actor: "steward",
      action: "extract_grant_terms",
      targetId: t.grantId,
      why: `Steward extracted terms from ${fileName}`,
      evidence: [fileName, t.grantId],
    });
  },
});

export const setGrantError = internalMutation({
  args: { grantDocId: v.id("grants"), message: v.string() },
  handler: async (ctx, { grantDocId, message }) => {
    await ctx.db.patch(grantDocId, { status: "error", error: message });
  },
});

export const loadPipelineInput = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [txns, gl, staff, precRows, grantRows] = await Promise.all([
      ctx.db.query("transactions").collect(),
      ctx.db.query("glRows").collect(),
      ctx.db.query("staffAllocations").collect(),
      ctx.db.query("precedents").collect(),
      ctx.db.query("grants").collect(),
    ]);
    const grants = grantRows
      .filter((g) => g.status === "ready" && g.terms)
      .map((g) => g.terms as GrantTerms);
    const precedents: Precedent[] = precRows.map((p, i) => ({
      id: `P${i + 1}`,
      date: p.date,
      by: p.by,
      ruling: p.ruling,
      scope: p.scope,
    }));
    return {
      txns: txns as Txn[],
      gl: gl as GlRow[],
      staff: staff as StaffAllocation[],
      precedents,
      grants,
    };
  },
});

export const getDecisionByTxn = internalQuery({
  args: { txnId: v.string() },
  handler: async (ctx, { txnId }) =>
    ctx.db.query("decisions").withIndex("by_txnId", (q) => q.eq("txnId", txnId)).first(),
});

export const createRun = internalMutation({
  args: {},
  handler: async (ctx) =>
    ctx.db.insert("runs", {
      startedAt: Date.now(),
      status: "running",
      progress: "Starting…",
      usageInput: 0,
      usageOutput: 0,
      errors: [],
    }),
});

export const updateRun = internalMutation({
  args: {
    runId: v.id("runs"),
    progress: v.optional(v.string()),
    usageInput: v.optional(v.number()),
    usageOutput: v.optional(v.number()),
    errors: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { runId, ...patch }) => {
    const updates: Record<string, unknown> = {};
    if (patch.progress !== undefined) updates.progress = patch.progress;
    if (patch.usageInput !== undefined) updates.usageInput = patch.usageInput;
    if (patch.usageOutput !== undefined) updates.usageOutput = patch.usageOutput;
    if (patch.errors !== undefined) updates.errors = patch.errors;
    if (Object.keys(updates).length) await ctx.db.patch(runId, updates);
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("runs"),
    status: v.union(v.literal("done"), v.literal("error")),
    usageInput: v.number(),
    usageOutput: v.number(),
    errors: v.array(v.string()),
  },
  handler: async (ctx, { runId, status, usageInput, usageOutput, errors }) => {
    await ctx.db.patch(runId, {
      status,
      finishedAt: Date.now(),
      usageInput,
      usageOutput,
      errors,
      progress: status === "done" ? "Complete" : "Failed",
    });
  },
});

export const savePipelineResults = internalMutation({
  args: {
    decisions: v.array(v.any()),
    entries: v.array(v.any()),
    journalLines: v.array(v.string()),
  },
  handler: async (ctx, { decisions, entries, journalLines }) => {
    for (const d of await ctx.db.query("decisions").collect()) {
      await ctx.db.delete(d._id);
    }
    for (const d of decisions as Decision[]) {
      await ctx.db.insert("decisions", {
        txnId: d.txnId,
        grantId: d.grantId,
        budgetLine: d.budgetLine,
        splits: d.splits,
        status: d.status,
        confidence: d.confidence,
        rationale: d.rationale,
        modelRationale: d.modelRationale ?? d.rationale,
        checks: d.checks,
        atRiskCents: d.atRiskCents,
        evidence: d.evidence,
        ruleHits: d.ruleHits,
      });
    }

    const runAt = new Date().toISOString();
    for (const line of journalLines) {
      await ctx.db.insert("auditLog", {
        at: runAt,
        actor: "steward",
        action: "run_summary",
        targetId: "run",
        why: line,
        evidence: [],
      });
    }

    for (const e of await ctx.db.query("proposedEntries").collect()) {
      if (e.state === "proposed") await ctx.db.delete(e._id);
    }
    let n = 0;
    for (const raw of entries as {
      txnId: string;
      date: string;
      memo: string;
      lines: { account: string; class: string | null; budgetLine: string | null; debitCents: number; creditCents: number }[];
    }[]) {
      n += 1;
      await ctx.db.insert("proposedEntries", {
        id: `PE-${raw.txnId}-${n}`,
        txnId: raw.txnId,
        date: raw.date,
        memo: raw.memo,
        lines: raw.lines.map((l) => ({
          account: l.account,
          class: l.class,
          budgetLine: l.budgetLine,
          debit: l.debitCents,
          credit: l.creditCents,
        })),
        state: "proposed",
        proposedBy: "steward",
        approvedBy: null,
      });
    }
  },
});

export const appendAudit = internalMutation({
  args: {
    actor: v.string(),
    action: v.string(),
    targetId: v.string(),
    why: v.string(),
    evidence: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLog", { at: new Date().toISOString(), ...args });
  },
});
