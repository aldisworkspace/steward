import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const FIVE_MIN_MS = 5 * 60 * 1000;

export const enqueueAgentRun = internalMutation({
  args: { journalLine: v.optional(v.string()) },
  handler: async (ctx, { journalLine }) => {
    if (journalLine) {
      await ctx.db.insert("auditLog", {
        at: new Date().toISOString(),
        actor: "steward",
        action: "run_summary",
        targetId: "bank_feed",
        why: journalLine,
        evidence: [],
      });
    }

    const now = Date.now();
    const runs = await ctx.db.query("runs").collect();
    for (const r of runs) {
      if (r.status === "running" && now - r.startedAt > FIVE_MIN_MS) {
        await ctx.db.patch(r._id, {
          status: "error",
          finishedAt: now,
          progress: "Failed",
          errors: [...r.errors, "error: timed out"],
        });
      }
    }

    const active = (await ctx.db.query("runs").collect()).find(
      (r) => r.status === "running" && now - r.startedAt < FIVE_MIN_MS,
    );

    const control = await ctx.db
      .query("agentRunControl")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .first();

    if (active) {
      if (control) await ctx.db.patch(control._id, { followUpRequested: true });
      else await ctx.db.insert("agentRunControl", { key: "main", followUpRequested: true });
      return;
    }

    if (control?.followUpRequested) {
      await ctx.db.patch(control._id, { followUpRequested: false });
    }
    await ctx.scheduler.runAfter(0, internal.agentRunner.run, {});
  },
});

export const scheduleFollowUpIfNeeded = internalMutation({
  args: {},
  handler: async (ctx) => {
    const control = await ctx.db
      .query("agentRunControl")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .first();
    if (!control?.followUpRequested) return;
    await ctx.db.patch(control._id, { followUpRequested: false });
    await ctx.scheduler.runAfter(0, internal.agentRunner.run, {});
  },
});
