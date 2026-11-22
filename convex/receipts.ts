import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertDemoPasscode } from "./passcode";
import { assertHumanApprover } from "./approverGuard";
import { matchReceipts } from "../lib/matchReceipts";
import type { ReceiptExtract, Txn } from "../lib/types";

export const generateUploadUrl = mutation({
  args: { passcode: v.optional(v.string()) },
  handler: async (ctx, { passcode }) => {
    assertDemoPasscode(passcode);
    return ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    passcode: v.optional(v.string()),
  },
  handler: async (ctx, { storageId, fileName, contentType, passcode }) => {
    assertDemoPasscode(passcode);
    return ctx.db.insert("receipts", {
      storageId, fileName, contentType, status: "uploaded", extracted: null,
      matchedTxnId: null, matchScore: null, matchedBy: null,
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("receipts").collect();
    return rows.map((r) => ({
      _id: r._id, fileName: r.fileName, status: r.status, error: r.error ?? null, extracted: r.extracted,
      matchedTxnId: r.matchedTxnId, matchScore: r.matchScore, matchedBy: r.matchedBy,
      matchCandidates: r.matchCandidates ?? [], matchNote: r.matchNote ?? null,
    }));
  },
});

/** Re-run the deterministic matcher over every receipt that a person has not linked. */
export async function rematchAll(ctx: MutationCtx) {
  const [receipts, txns] = await Promise.all([
    ctx.db.query("receipts").collect(),
    ctx.db.query("transactions").collect(),
  ]);
  const ready = receipts.filter((r) => r.status === "ready");
  const result = matchReceipts(
    ready.map((r) => ({ receiptId: String(r._id), extracted: r.extracted as ReceiptExtract | null, matchedTxnId: r.matchedTxnId, matchedBy: r.matchedBy })),
    txns as unknown as Txn[],
  );
  const known = new Set(txns.map((t) => t.txnId));
  for (const r of ready) {
    const m = result.get(String(r._id));
    if (!m) continue;
    // A human link to a line that no longer exists (new workspace) is dropped, not kept dangling.
    if (m.matchedBy === "human" && m.matchedTxnId && !known.has(m.matchedTxnId)) {
      await ctx.db.patch(r._id, { matchedTxnId: null, matchScore: null, matchedBy: null, matchCandidates: [], matchNote: "linked line no longer exists" });
      continue;
    }
    await ctx.db.patch(r._id, {
      matchedTxnId: m.matchedTxnId, matchScore: m.matchScore, matchedBy: m.matchedBy,
      matchCandidates: m.candidates, matchNote: m.note,
    });
  }
}

export const getForExtraction = internalQuery({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, { receiptId }) => ctx.db.get(receiptId),
});

export const setExtracting = internalMutation({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, { receiptId }) => {
    await ctx.db.patch(receiptId, { status: "extracting", error: undefined });
  },
});

export const setReady = internalMutation({
  args: {
    receiptId: v.id("receipts"),
    extracted: v.object({
      vendor: v.union(v.string(), v.null()),
      date: v.union(v.string(), v.null()),
      totalCents: v.union(v.number(), v.null()),
      lineItems: v.array(v.object({ description: v.string(), amountCents: v.number() })),
      purposeText: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, { receiptId, extracted }) => {
    const doc = await ctx.db.get(receiptId);
    await ctx.db.patch(receiptId, { status: "ready", extracted, error: undefined });
    await ctx.db.insert("auditLog", {
      at: new Date().toISOString(),
      actor: "steward",
      action: "extract_receipt",
      targetId: String(receiptId),
      why: `Steward read ${doc?.fileName ?? "a receipt"}`,
      evidence: [doc?.fileName ?? "", extracted.vendor ?? "", extracted.totalCents == null ? "no total" : String(extracted.totalCents)],
    });
    await rematchAll(ctx);
    await ctx.runMutation(internal.ingest.tryAutoRunPipeline, {});
  },
});

export const setError = internalMutation({
  args: { receiptId: v.id("receipts"), message: v.string() },
  handler: async (ctx, { receiptId, message }) => {
    await ctx.db.patch(receiptId, { status: "error", error: message });
  },
});

/** A person links a receipt to a GL line (or unlinks it with txnId null). Logged; overrides the matcher. */
export const link = mutation({
  args: {
    receiptId: v.id("receipts"),
    txnId: v.union(v.string(), v.null()),
    by: v.string(),
    note: v.optional(v.string()),
    passcode: v.optional(v.string()),
  },
  handler: async (ctx, { receiptId, txnId, by, note, passcode }) => {
    assertDemoPasscode(passcode);
    await assertHumanApprover(ctx, by, txnId ?? "");
    const r = await ctx.db.get(receiptId);
    if (!r) throw new ConvexError("Receipt not found");
    if (txnId) {
      const t = await ctx.db.query("transactions").withIndex("by_txnId", (q) => q.eq("txnId", txnId)).first();
      if (!t) throw new ConvexError(`No GL line ${txnId}`);
      const other = await ctx.db.query("receipts").withIndex("by_matchedTxnId", (q) => q.eq("matchedTxnId", txnId)).collect();
      for (const o of other) {
        if (o._id === receiptId) continue;
        // One receipt per line: the displaced receipt goes back to the matcher's pool.
        await ctx.db.patch(o._id, { matchedTxnId: null, matchScore: null, matchedBy: null, matchNote: `replaced by ${r.fileName}` });
      }
    }
    const previous = r.matchedTxnId;
    await ctx.db.patch(receiptId, {
      matchedTxnId: txnId, matchScore: txnId ? 1 : null, matchedBy: "human", matchCandidates: [],
      matchNote: txnId ? `linked by ${by}` : `unlinked by ${by}`,
    });
    await ctx.db.insert("auditLog", {
      at: new Date().toISOString(),
      actor: by,
      action: txnId ? "link_receipt" : "unlink_receipt",
      targetId: String(receiptId),
      why: note?.trim() || `${r.fileName}: ${previous ?? "unmatched"} → ${txnId ?? "unmatched"}`,
      evidence: [r.fileName, previous ?? "", txnId ?? ""].filter(Boolean),
    });
    await ctx.runMutation(internal.ingest.tryAutoRunPipeline, {});
  },
});

export const remove = mutation({
  args: { receiptId: v.id("receipts"), passcode: v.optional(v.string()) },
  handler: async (ctx, { receiptId, passcode }) => {
    assertDemoPasscode(passcode);
    const r = await ctx.db.get(receiptId);
    if (!r) return;
    await ctx.db.delete(receiptId);
    await ctx.db.insert("auditLog", {
      at: new Date().toISOString(), actor: "user", action: "remove_receipt", targetId: String(receiptId),
      why: `Removed ${r.fileName}`, evidence: [r.fileName],
    });
    await rematchAll(ctx);
  },
});
