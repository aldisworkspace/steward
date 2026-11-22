/**
 * Program-side approval of GL lines ("yes, this was for our program"), one line at a time or in bulk
 * by department. Required by the PROGRAM_APPROVAL tie-out check unless a reviewer resolved the line.
 * Name-based roles until real auth (see convex/approverGuard.ts).
 */
import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertDemoPasscode } from "./passcode";
import { assertProgramApprover, assertRole } from "./approverGuard";

async function approveRows(ctx: MutationCtx, rows: Doc<"transactions">[], by: string, why: string) {
  if (!rows.length) throw new ConvexError("No GL lines to approve.");
  const at = new Date().toISOString();
  let who = by.trim();
  for (const t of rows) {
    if (t.source === "bank") throw new ConvexError(`${t.txnId} is a bank line that is not in the GL yet.`);
    who = await assertProgramApprover(ctx, by, t.txnId);
  }
  for (const t of rows) await ctx.db.patch(t._id, { programApprovedBy: who, programApprovedAt: at });
  await ctx.db.insert("auditLog", {
    at, actor: who, action: "program_approve", targetId: rows.length === 1 ? rows[0]!.txnId : `${rows.length} lines`,
    why, evidence: rows.slice(0, 50).map((t) => t.txnId),
  });
  return rows.length;
}

export const approveLines = mutation({
  args: { txnIds: v.array(v.string()), by: v.string(), note: v.optional(v.string()), passcode: v.optional(v.string()) },
  handler: async (ctx, { txnIds, by, note, passcode }) => {
    assertDemoPasscode(passcode);
    const rows: Doc<"transactions">[] = [];
    for (const id of [...new Set(txnIds)]) {
      const t = await ctx.db.query("transactions").withIndex("by_txnId", (q) => q.eq("txnId", id)).first();
      if (!t) throw new ConvexError(`No GL line ${id}`);
      rows.push(t);
    }
    return approveRows(ctx, rows, by, note?.trim() || "Program approval");
  },
});

/** Bulk: every not-yet-approved line of one department (optionally one grant and date range). */
export const approveDepartment = mutation({
  args: {
    department: v.string(),
    grantId: v.optional(v.string()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    by: v.string(),
    passcode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const all = await ctx.db.query("transactions").collect();
    const rows = all.filter((t) => t.source === "gl" && (t.department ?? "") === args.department && !t.programApprovedBy &&
      (!args.grantId || t.glClass === args.grantId) &&
      (!args.periodStart || t.date >= args.periodStart) && (!args.periodEnd || t.date <= args.periodEnd));
    return approveRows(ctx, rows, args.by,
      `Program approval for ${args.department}${args.grantId ? ` / ${args.grantId}` : ""}${args.periodStart ? ` ${args.periodStart}–${args.periodEnd ?? ""}` : ""}`);
  },
});

export const revoke = mutation({
  args: { txnId: v.string(), by: v.string(), reason: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { txnId, by, reason, passcode }) => {
    assertDemoPasscode(passcode);
    const who = await assertRole(ctx, by, "program_approver");
    if (!reason.trim()) throw new ConvexError("Say why the approval is revoked.");
    const t = await ctx.db.query("transactions").withIndex("by_txnId", (q) => q.eq("txnId", txnId)).first();
    if (!t?.programApprovedBy) throw new ConvexError(`${txnId} has no program approval.`);
    await ctx.db.patch(t._id, { programApprovedBy: null, programApprovedAt: undefined });
    await ctx.db.insert("auditLog", { at: new Date().toISOString(), actor: who, action: "program_revoke", targetId: txnId, why: reason.trim(), evidence: [t.programApprovedBy] });
  },
});
