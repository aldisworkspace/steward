import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { assertDemoPasscode } from "./passcode";
import { assertHumanApprover } from "./approverGuard";

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
  args: { entryId: v.string(), by: v.string(), note: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { entryId, by, note, passcode }) => {
    assertDemoPasscode(passcode);
    const entry = (await ctx.db.query("proposedEntries").collect()).find((e) => e.id === entryId);
    if (!entry) throw new Error("Entry not found");
    await assertHumanApprover(ctx, by, entry.txnId);
    if (entry.state !== "proposed") throw new Error(`Entry is already ${entry.state}`);
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
    await ctx.db.insert("precedents", {
      date: at.slice(0, 10),
      by,
      ruling: note,
      scope: entry.txnId,
    });
    await ctx.db.insert("auditLog", {
      at,
      actor: by,
      action: "precedent_recorded",
      targetId: entry.txnId,
      why: "Precedent recorded",
      evidence: [note.slice(0, 120)],
    });
  },
});

export const acknowledgeDecision = mutation({
  args: { txnId: v.string(), by: v.string(), note: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { txnId, by, note, passcode }) => {
    assertDemoPasscode(passcode);
    await assertHumanApprover(ctx, by, txnId);
    const existing = await ctx.db
      .query("inboxResolutions")
      .withIndex("by_txnId", (q) => q.eq("txnId", txnId))
      .first();
    if (existing) throw new Error("Already resolved");
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
  },
});

export const overrideDecision = mutation({
  args: { txnId: v.string(), by: v.string(), note: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { txnId, by, note, passcode }) => {
    assertDemoPasscode(passcode);
    await assertHumanApprover(ctx, by, txnId);
    const existing = await ctx.db
      .query("inboxResolutions")
      .withIndex("by_txnId", (q) => q.eq("txnId", txnId))
      .first();
    if (existing) throw new Error("Already resolved");
    const at = new Date().toISOString();
    await ctx.db.insert("inboxResolutions", {
      txnId,
      resolution: "overridden",
      by,
      at,
      note,
    });
    await ctx.db.insert("precedents", {
      date: at.slice(0, 10),
      by,
      ruling: note,
      scope: txnId,
    });
    await ctx.db.insert("auditLog", {
      at,
      actor: by,
      action: "override_decision",
      targetId: txnId,
      why: note,
      evidence: [],
    });
  },
});
