import { v } from "convex/values";
import { internalAction, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertDemoPasscode } from "./passcode";
import type { GrantTerms } from "../lib/types";

function daysUntil(isoDate: string, from = new Date()) {
  return Math.ceil((Date.parse(isoDate) - from.getTime()) / 86_400_000);
}

export const appendDeadlineLines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [grants, decisions, entries, resolutions] = await Promise.all([
      ctx.db.query("grants").collect(),
      ctx.db.query("decisions").collect(),
      ctx.db.query("proposedEntries").collect(),
      ctx.db.query("inboxResolutions").collect(),
    ]);
    const settled = new Set(
      entries.filter((e) => e.state === "approved" || e.state === "rejected").map((e) => e.txnId),
    );
    for (const r of resolutions) settled.add(r.txnId);
    const needYou = decisions.filter((d) => d.status !== "auto" && !settled.has(d.txnId)).length;

    const at = new Date().toISOString();
    for (const g of grants) {
      if (g.status !== "ready" || !g.terms) continue;
      const terms = g.terms as GrantTerms;
      if (!terms.reportDue) continue;
      const days = daysUntil(terms.reportDue);
      if (days > 21 || days < 0) continue;
      const dueLabel = new Date(terms.reportDue + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      await ctx.db.insert("auditLog", {
        at,
        actor: "steward",
        action: "run_summary",
        targetId: terms.grantId,
        why: `Funder report for ${terms.grantId} is due ${dueLabel} (${days} days). Draft is ready; ${needYou} item${needYou === 1 ? "" : "s"} still need you.`,
        evidence: [],
      });
    }
  },
});

export const runMorningCheck = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.deadlines.appendDeadlineLines, {});
  },
});

export const triggerMorningCheck = mutation({
  args: { passcode: v.optional(v.string()) },
  handler: async (ctx, { passcode }) => {
    assertDemoPasscode(passcode);
    await ctx.scheduler.runAfter(0, internal.deadlines.runMorningCheck, {});
  },
});
