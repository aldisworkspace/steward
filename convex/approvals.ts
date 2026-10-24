import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { assertDemoPasscode } from "./passcode";
import { assertHumanApprover } from "./approverGuard";
import { insertTypedPrecedent } from "./precedentUtil";
import { internal } from "./_generated/api";
import type { RulingType } from "../lib/types";

const rulingTypeV = v.union(
  v.literal("allow"),
  v.literal("disallow"),
  v.literal("prior_approval_granted"),
  v.literal("not_duplicate"),
);

export const approveEntry = mutation({
  args: { entryId: v.string(), by: v.string(), note: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { entryId, by, note, passcode }) => {
    assertDemoPasscode(passcode);
    const entry = (await ctx.db.query("proposedEntries").collect()).find((e) => e.id === entryId);
    if (!entry) throw new Error("Entry not found");
    await assertHumanApprover(ctx, by, entry.txnId);
    if (entry.state !== "proposed") throw new Error(`Entry is already ${entry.state}`);
    await ctx.db.patch(entry._id, { state: "approved", approvedBy: by });
    const at = new Date().toISOString();
    await ctx.db.insert("approvals", { entryId, decision: "approved", by, note, at });
    await ctx.db.insert("auditLog", {
      at,
      actor: by,
      action: "approve_entry",
      targetId: entryId,
      why: note,
      evidence: [entry.txnId],
    });
  },
});

export const rejectEntry = mutation({
  args: {
    entryId: v.string(),
    by: v.string(),
    note: v.string(),
    passcode: v.optional(v.string()),
    precedentScope: v.optional(v.union(v.literal("txn"), v.literal("vendor"))),
    rulingType: v.optional(rulingTypeV),
    grantScope: v.optional(v.string()),
  },
  handler: async (ctx, { entryId, by, note, passcode, precedentScope, rulingType, grantScope }) => {
    assertDemoPasscode(passcode);
    const entry = (await ctx.db.query("proposedEntries").collect()).find((e) => e.id === entryId);
    if (!entry) throw new Error("Entry not found");
    await assertHumanApprover(ctx, by, entry.txnId);
    if (entry.state !== "proposed") throw new Error(`Entry is already ${entry.state}`);
    const txn = await ctx.db
      .query("transactions")
      .withIndex("by_txnId", (q) => q.eq("txnId", entry.txnId))
      .first();
    await ctx.db.patch(entry._id, { state: "rejected", approvedBy: by });
    const at = new Date().toISOString();
    await ctx.db.insert("approvals", { entryId, decision: "rejected", by, note, at });
    await ctx.db.insert("auditLog", {
      at,
      actor: by,
      action: "reject_entry",
      targetId: entryId,
      why: note,
      evidence: [entry.txnId],
    });
    if (rulingType) {
      await insertTypedPrecedent(ctx, {
        date: at.slice(0, 10),
        by,
        scope: grantScope ?? "ALL",
        rulingType: rulingType as RulingType,
        note,
        txnId: precedentScope === "vendor" ? undefined : entry.txnId,
        vendorScope: precedentScope === "vendor",
        description: txn?.description,
      });
    } else {
      await ctx.db.insert("precedents", { date: at.slice(0, 10), by, ruling: note, scope: entry.txnId });
      await ctx.db.insert("auditLog", {
        at,
        actor: by,
        action: "precedent_recorded",
        targetId: entry.txnId,
        why: "Precedent recorded",
        evidence: [note.slice(0, 120)],
      });
    }
    await ctx.runMutation(internal.autonomy.enqueueAgentRun, {});
  },
});

export const acknowledgeDecision = mutation({
  args: {
    txnId: v.string(),
    by: v.string(),
    note: v.string(),
    passcode: v.optional(v.string()),
    precedentScope: v.optional(v.union(v.literal("txn"), v.literal("vendor"))),
    rulingType: v.optional(rulingTypeV),
    grantScope: v.optional(v.string()),
  },
  handler: async (ctx, { txnId, by, note, passcode, precedentScope, rulingType, grantScope }) => {
    assertDemoPasscode(passcode);
    await assertHumanApprover(ctx, by, txnId);
    const existing = await ctx.db
      .query("inboxResolutions")
      .withIndex("by_txnId", (q) => q.eq("txnId", txnId))
      .first();
    if (existing) throw new Error("Already resolved");
    const txn = await ctx.db
      .query("transactions")
      .withIndex("by_txnId", (q) => q.eq("txnId", txnId))
      .first();
    const at = new Date().toISOString();
    await ctx.db.insert("inboxResolutions", {
      txnId,
      resolution: "acknowledged",
      by,
      at,
      note,
    });
    await ctx.db.insert("auditLog", {
      at,
      actor: by,
      action: "acknowledge_decision",
      targetId: txnId,
      why: note,
      evidence: [],
    });
    if (rulingType) {
      await insertTypedPrecedent(ctx, {
        date: at.slice(0, 10),
        by,
        scope: grantScope ?? "ALL",
        rulingType: rulingType as RulingType,
        note,
        txnId: precedentScope === "vendor" ? undefined : txnId,
        vendorScope: precedentScope === "vendor",
        description: txn?.description,
      });
      await ctx.runMutation(internal.autonomy.enqueueAgentRun, {});
    }
  },
});

export const overrideDecision = mutation({
  args: {
    txnId: v.string(),
    by: v.string(),
    note: v.string(),
    passcode: v.optional(v.string()),
    precedentScope: v.optional(v.union(v.literal("txn"), v.literal("vendor"))),
    rulingType: v.optional(rulingTypeV),
    grantScope: v.optional(v.string()),
  },
  handler: async (ctx, { txnId, by, note, passcode, precedentScope, rulingType, grantScope }) => {
    assertDemoPasscode(passcode);
    await assertHumanApprover(ctx, by, txnId);
    const existing = await ctx.db
      .query("inboxResolutions")
      .withIndex("by_txnId", (q) => q.eq("txnId", txnId))
      .first();
    if (existing) throw new Error("Already resolved");
    const txn = await ctx.db
      .query("transactions")
      .withIndex("by_txnId", (q) => q.eq("txnId", txnId))
      .first();
    const at = new Date().toISOString();
    await ctx.db.insert("inboxResolutions", {
      txnId,
      resolution: "overridden",
      by,
      at,
      note,
    });
    if (rulingType) {
      await insertTypedPrecedent(ctx, {
        date: at.slice(0, 10),
        by,
        scope: grantScope ?? "ALL",
        rulingType: rulingType as RulingType,
        note,
        txnId: precedentScope === "vendor" ? undefined : txnId,
        vendorScope: precedentScope === "vendor",
        description: txn?.description,
      });
    } else {
      await ctx.db.insert("precedents", { date: at.slice(0, 10), by, ruling: note, scope: txnId });
    }
    await ctx.db.insert("auditLog", {
      at,
      actor: by,
      action: "override_decision",
      targetId: txnId,
      why: note,
      evidence: [],
    });
    await ctx.runMutation(internal.autonomy.enqueueAgentRun, {});
  },
});
