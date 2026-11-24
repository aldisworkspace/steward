/**
 * Read-only dump + maintenance hooks for scripts/eval-v2-dev.ts (internal functions only, so they can be
 * called with `npx convex run` but never from a client). Never reads the answer key.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { rematchAll } from "./receipts";

/** Everything the scorer needs: lines, the bookkeeper's claims, receipts (no file bytes) and decisions. */
export const dump = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [transactions, decisions, receipts, runs] = await Promise.all([
      ctx.db.query("transactions").collect(),
      ctx.db.query("decisions").collect(),
      ctx.db.query("receipts").collect(),
      ctx.db.query("runs").collect(),
    ]);
    const lastRun = runs.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
    return {
      transactions: transactions.map(({ _id, _creationTime, ...t }) => t),
      decisions: decisions.map(({ _id, _creationTime, ...d }) => d),
      receipts: receipts.map((r) => ({
        receiptId: String(r._id), fileName: r.fileName, status: r.status, extracted: r.extracted,
        matchedTxnId: r.matchedTxnId, matchedBy: r.matchedBy, matchScore: r.matchScore,
        matchCandidates: r.matchCandidates ?? [], matchNote: r.matchNote ?? null,
      })),
      lastRun: lastRun && { status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt ?? null, errors: lastRun.errors },
    };
  },
});

/** Re-run the deterministic receipt matcher (after a matcher change) without re-reading receipts. */
export const rematchReceipts = internalMutation({
  args: {},
  handler: async (ctx) => {
    await rematchAll(ctx);
    const rows = await ctx.db.query("receipts").collect();
    return { receipts: rows.length, matched: rows.filter((r) => r.matchedTxnId).length };
  },
});

/**
 * Force the next seed to re-read these contracts (after an extraction-prompt change): drops the cached terms,
 * keeps the stored PDF. Dev maintenance only (internal); audited like any change to grant terms.
 */
export const resetGrantTerms = internalMutation({
  args: { fileNames: v.array(v.string()) },
  handler: async (ctx, { fileNames }) => {
    const reset: string[] = [];
    for (const fileName of fileNames) {
      const g = await ctx.db.query("grants").withIndex("by_fileName", (q) => q.eq("fileName", fileName)).first();
      if (!g) continue;
      await ctx.db.patch(g._id, { terms: null, status: "uploaded", error: undefined });
      await ctx.db.insert("auditLog", { at: new Date().toISOString(), actor: "eval script", action: "grant_terms_reset",
        targetId: String(g._id), why: "Re-extract terms after an extraction prompt change (dev eval).", evidence: [fileName] });
      reset.push(fileName);
    }
    return { reset };
  },
});
