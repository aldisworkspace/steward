"use node";
// bundled with ../lib/* (pipeline, prompts) for Claude structured outputs

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getModelClient, getModelProvider } from "../lib/model";
import { MODELS } from "../lib/llm";
import { EXTRACT_SYSTEM } from "../lib/prompts";
import { buildRunJournalLines } from "../lib/journalSummary";
import { defendDecision, extractGrantTerms, runPipeline } from "../lib/pipeline";
import type { GrantTerms } from "../lib/types";
import { GrantTermsZ } from "../lib/types";
import { pdfToText } from "./pdfText";
import { assertDemoPasscode } from "./passcode";

export const extractGrant = action({
  args: { grantDocId: v.id("grants"), passcode: v.optional(v.string()) },
  handler: async (
    ctx,
    { grantDocId, passcode },
  ): Promise<{ grantId: string; budgetLines: number; skipped: boolean }> => {
    assertDemoPasscode(passcode);
    const grant = await ctx.runQuery(internal.agentInternal.getGrant, { grantDocId });
    if (!grant) throw new Error("Grant not found");
    if (grant.status === "ready" && grant.terms) {
      const t = grant.terms as GrantTerms;
      return { grantId: t.grantId, budgetLines: t.budgetLines.length, skipped: true };
    }
    await ctx.runMutation(internal.agentInternal.setGrantExtracting, { grantDocId });
    try {
      const blob = await ctx.storage.get(grant.storageId);
      if (!blob) throw new Error("PDF missing from storage");
      const buf: Buffer = Buffer.from(await blob.arrayBuffer());
      const b64 = buf.toString("base64");
      const model = getModelClient();
      const terms: GrantTerms =
        getModelProvider() === "xai"
          ? (
              await model.json({
                model: MODELS.judgment,
                system: EXTRACT_SYSTEM,
                toolName: "record_grant_terms",
                toolDescription: "Record the financial terms of this grant agreement.",
                schema: GrantTermsZ,
                content: [
                  {
                    type: "text",
                    text: `Extract the grant terms.\n\n${await pdfToText(buf)}`,
                  },
                ],
              })
            ).data
          : await extractGrantTerms(model, b64);
      await ctx.runMutation(internal.agentInternal.setGrantReady, {
        grantDocId,
        terms,
        fileName: grant.fileName,
      });
      return { grantId: terms.grantId, budgetLines: terms.budgetLines.length, skipped: false };
    } catch (e) {
      const message = (e as Error).message;
      await ctx.runMutation(internal.agentInternal.setGrantError, { grantDocId, message });
      throw e;
    }
  },
});

export const runAgent = action({
  args: { passcode: v.optional(v.string()) },
  handler: async (
    ctx,
    { passcode },
  ): Promise<{
    runId: Id<"runs">;
    usageInput: number;
    usageOutput: number;
    errors: string[];
    decisionCount: number;
  }> => {
    assertDemoPasscode(passcode);
    await ctx.runMutation(internal.runGuard.prepareRun, {});
    const input = await ctx.runQuery(internal.agentInternal.loadPipelineInput, {});
    if (input.grants.length < 1) {
      throw new Error("At least one grant agreement must be ready before running Steward.");
    }
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
  args: { txnId: v.string(), question: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { txnId, question, passcode }) => {
    assertDemoPasscode(passcode);
    const q = question.trim();
    if (q.length > 500) throw new Error("Question must be at most 500 characters.");
    const decision = await ctx.runQuery(internal.agentInternal.getDecisionByTxn, { txnId });
    if (!decision) throw new Error(`No decision for ${txnId}`);
    const { grants } = await ctx.runQuery(internal.agentInternal.loadPipelineInput, {});
    await ctx.runMutation(internal.agentInternal.appendAudit, {
      actor: "auditor-question",
      action: "challenge",
      targetId: txnId,
      why: q,
      evidence: [],
    });
    const answer = await defendDecision(getModelClient(), {
      question: q,
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
