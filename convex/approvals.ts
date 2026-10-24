import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const approveEntry = mutation({
  args: { entryId: v.string(), by: v.string(), note: v.string() },
  handler: async (ctx, { entryId, by, note }) => {
    if (by === "steward") throw new Error("Steward cannot approve its own entries.");
    const entry = (await ctx.db.query("proposedEntries").collect()).find((e) => e.id === entryId);
    if (!entry) throw new Error("Entry not found");
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
  args: { entryId: v.string(), by: v.string(), note: v.string() },
  handler: async (ctx, { entryId, by, note }) => {
    if (by === "steward") throw new Error("Steward cannot reject on its own behalf.");
    const entry = (await ctx.db.query("proposedEntries").collect()).find((e) => e.id === entryId);
    if (!entry) throw new Error("Entry not found");
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
