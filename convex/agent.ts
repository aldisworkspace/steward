"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { grokClient } from "../lib/grok";
import { MODELS } from "../lib/llm";
import { EXTRACT_SYSTEM } from "../lib/prompts";
import { defendDecision, runPipeline } from "../lib/pipeline";
import type { GrantTerms } from "../lib/types";
import { GrantTermsZ } from "../lib/types";
import { pdfToText } from "./pdfText";

export const extractGrant = action({
  args: { grantDocId: v.id("grants") },
  handler: async (ctx, { grantDocId }) => {
    const grant = await ctx.runQuery(internal.agentInternal.getGrant, { grantDocId });
    if (!grant) throw new Error("Grant not found");
    await ctx.runMutation(internal.agentInternal.setGrantExtracting, { grantDocId });
    try {
      const blob = await ctx.storage.get(grant.storageId);
      if (!blob) throw new Error("PDF missing from storage");
      const buf = Buffer.from(await blob.arrayBuffer());
      const pdfText = await pdfToText(buf);
      const { data: terms } = await grokClient().json({
        model: MODELS.judgment,
        system: EXTRACT_SYSTEM,
        toolName: "record_grant_terms",
        toolDescription: "Record the financial terms of this grant agreement.",
        schema: GrantTermsZ,
        content: [{ type: "text", text: `Extract the grant terms.\n\n${pdfText}` }],
      });
      await ctx.runMutation(internal.agentInternal.setGrantReady, {
        grantDocId,
        terms,
        fileName: grant.fileName,
      });
      return { grantId: terms.grantId, budgetLines: terms.budgetLines.length };
    } catch (e) {
      const message = (e as Error).message;
      await ctx.runMutation(internal.agentInternal.setGrantError, { grantDocId, message });
      throw e;
    }
  },
});

export const runAgent = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    runId: Id<"runs">;
    usageInput: number;
    usageOutput: number;
    errors: string[];
    decisionCount: number;
  }> => {
    const input = await ctx.runQuery(internal.agentInternal.loadPipelineInput, {});
    if (input.grants.length < 2) {
      throw new Error("Both grant agreements must be ready before running Steward.");
    }
    const runId: Id<"runs"> = await ctx.runMutation(internal.agentInternal.createRun, {});
    let usageInput = 0;
    let usageOutput = 0;
    const errors: string[] = [];
    try {
      const result = await runPipeline(grokClient(), input, async (done, total) => {
        await ctx.runMutation(internal.agentInternal.updateRun, {
          runId,
          progress: `Coding transactions ${done}/${total}`,
        });
      });
      usageInput = result.usage.input;
      usageOutput = result.usage.output;
      errors.push(...result.errors);
      await ctx.runMutation(internal.agentInternal.savePipelineResults, {
        decisions: result.decisions,
        entries: result.entries,
      });
      await ctx.runMutation(internal.agentInternal.finishRun, {
        runId,
        status: errors.length ? "error" : "done",
        usageInput,
        usageOutput,
        errors,
      });
      return { runId, usageInput, usageOutput, errors, decisionCount: result.decisions.length };
    } catch (e) {
      const message = (e as Error).message;
      errors.push(message);
      await ctx.runMutation(internal.agentInternal.finishRun, {
        runId,
        status: "error",
        usageInput,
        usageOutput,
        errors,
      });
      throw e;
    }
  },
});

export const explain = action({
  args: { txnId: v.string(), question: v.string() },
  handler: async (ctx, { txnId, question }) => {
    const decision = await ctx.runQuery(internal.agentInternal.getDecisionByTxn, { txnId });
    if (!decision) throw new Error(`No decision for ${txnId}`);
    const { grants } = await ctx.runQuery(internal.agentInternal.loadPipelineInput, {});
    await ctx.runMutation(internal.agentInternal.appendAudit, {
      actor: "auditor-question",
      action: "challenge",
      targetId: txnId,
      why: question,
      evidence: [],
    });
    const answer = await defendDecision(grokClient(), {
      question,
      decision: decision as Parameters<typeof defendDecision>[1]["decision"],
      grants: grants as GrantTerms[],
    });
    await ctx.runMutation(internal.agentInternal.appendAudit, {
      actor: "steward",
      action: "defend_decision",
      targetId: txnId,
      why: answer.answer,
      evidence: answer.citedEvidence ?? [],
    });
    return answer;
  },
});
