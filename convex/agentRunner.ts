"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getModelClient } from "../lib/model";
import { buildRunJournalLines } from "../lib/journalSummary";
import { runPipeline } from "../lib/pipeline";

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    try {
      await ctx.runMutation(internal.runGuard.prepareRun, {});
    } catch {
      await ctx.runMutation(internal.autonomy.scheduleFollowUpIfNeeded, {});
      return;
    }

    const input = await ctx.runQuery(internal.agentInternal.loadPipelineInput, {});
    if (input.grants.length < 1) return;

    const runId: Id<"runs"> = await ctx.runMutation(internal.agentInternal.createRun, {});
    let usageInput = 0;
    let usageOutput = 0;
    const errors: string[] = [];
    try {
      const result = await runPipeline(getModelClient(), input, async (done, total) => {
        await ctx.runMutation(internal.agentInternal.updateRun, {
          runId,
          progress: `Coding transactions ${done}/${total}`,
        });
      });
      usageInput = result.usage.input;
      usageOutput = result.usage.output;
      errors.push(...result.errors);
      const journalLines = buildRunJournalLines({
        txns: input.txns,
        gl: input.gl,
        staff: input.staff,
        decisions: result.decisions,
        findings: result.findings,
        entries: result.entries,
      });
      await ctx.runMutation(internal.agentInternal.savePipelineResults, {
        runId,
        decisions: result.decisions,
        entries: result.entries,
        journalLines,
      });
      await ctx.runMutation(internal.agentInternal.finishRun, {
        runId,
        status: errors.length ? "error" : "done",
        usageInput,
        usageOutput,
        errors,
      });
    } catch (e) {
      errors.push((e as Error).message);
      await ctx.runMutation(internal.agentInternal.finishRun, {
        runId,
        status: "error",
        usageInput,
        usageOutput,
        errors,
      });
    }
    await ctx.runMutation(internal.autonomy.scheduleFollowUpIfNeeded, {});
  },
});
