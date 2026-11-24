/**
 * Read-only dump + maintenance hooks for scripts/eval-v2-dev.ts (internal functions only, so they can be
 * called with `npx convex run` but never from a client). Never reads the answer key.
 */
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
