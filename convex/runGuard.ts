import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const FIVE_MIN_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_RUNS_PER_HOUR = 20;

export const prepareRun = internalMutation({
  args: {},
  handler: async (ctx) => {
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
    const fresh = await ctx.db.query("runs").collect();
    const active = fresh.find((r) => r.status === "running" && now - r.startedAt < FIVE_MIN_MS);
    if (active) {
      throw new Error("A run is already in progress. Wait for it to finish.");
    }
    const recent = fresh.filter((r) => r.startedAt > now - HOUR_MS).length;
    if (recent >= MAX_RUNS_PER_HOUR) {
      throw new Error("Run limit reached (20 per hour). Try again later.");
    }
  },
});
