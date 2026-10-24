import { v } from "convex/values";
import { z } from "zod";
import { action, query } from "./_generated/server";
import { api } from "./_generated/api";
import { getModelClient } from "../lib/model";
import { MODELS } from "../lib/llm";
import type { GrantTerms } from "../lib/types";
import { assertDemoPasscode } from "./passcode";

const NarrativeZ = z.object({ narrative: z.string().max(2000) });

export const grantReportData = query({
  args: { grantId: v.string() },
  handler: async (ctx, { grantId }) => {
    const [grants, decisions, txns, entries] = await Promise.all([
      ctx.db.query("grants").collect(),
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("proposedEntries").collect(),
    ]);
    const grant = grants.find((g) => (g.terms as GrantTerms | null)?.grantId === grantId);
    const terms = grant?.terms as GrantTerms | null;
    if (!terms) return null;

    const approved = new Set(entries.filter((e) => e.state === "approved").map((e) => e.txnId));
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));

    const lines = terms.budgetLines.map((bl) => {
      let actual = 0;
      for (const d of decisions) {
        const t = byTxn.get(d.txnId);
        if (!t || t.amountCents >= 0) continue;
        if (d.status !== "auto" && !approved.has(d.txnId)) continue;
        if (d.splits) {
          for (const s of d.splits as { grantId: string | null; budgetLine: string | null; amount: number }[]) {
            if (s.grantId === grantId && s.budgetLine === bl.code) actual += Math.abs(s.amount);
          }
        } else if (d.grantId === grantId && d.budgetLine === bl.code) {
          actual += Math.abs(t.amountCents);
        }
      }
      const budget = Math.round(bl.amount * 100);
      const remaining = budget - actual;
      const pct = budget ? (actual / budget) * 100 : 0;
      const cap = terms.lineVarianceLimitPct
        ? Math.round(budget * (1 + terms.lineVarianceLimitPct / 100))
        : budget;
      const over = actual > cap;
      return { code: bl.code, name: bl.name, budget, actual, remaining, pct, over, cap };
    });

    const excluded = decisions.filter((d) => {
      if (d.status === "auto" || approved.has(d.txnId)) return false;
      const t = byTxn.get(d.txnId);
      if (!t || t.amountCents >= 0) return false;
      if (d.grantId === grantId) return true;
      return (d.splits as { grantId: string | null }[] | undefined)?.some((s) => s.grantId === grantId) ?? false;
    });

    let excludedCents = 0;
    for (const d of excluded) {
      const t = byTxn.get(d.txnId)!;
      excludedCents += Math.abs(t.amountCents);
    }

    return { terms, lines, excludedCount: excluded.length, excludedCents };
  },
});

export const regenerateNarrative = action({
  args: { grantId: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { grantId, passcode }): Promise<string> => {
    assertDemoPasscode(passcode);
    const data = await ctx.runQuery(api.report.grantReportData, { grantId });
    if (!data) throw new Error("Grant not found");
    const model = getModelClient();
    const payload: string = JSON.stringify({
      grantId: data.terms.grantId,
      program: data.terms.program,
      period: [data.terms.periodStart, data.terms.periodEnd],
      lines: data.lines.map((l: { code: string; name: string; budget: number; actual: number; remaining: number; pct: number; over: boolean }) => ({
        line: l.code,
        name: l.name,
        budgetUsd: l.budget / 100,
        actualUsd: l.actual / 100,
        remainingUsd: l.remaining / 100,
        pctUsed: Math.round(l.pct),
        overVariance: l.over,
      })),
      excludedPending: data.excludedCount,
    });
    const { data: out } = await model.json({
      model: MODELS.judgment,
      system:
        "You draft funder budget-vs-actual report narratives for a nonprofit. Use only the numbers provided. Write 3-5 complete sentences in plain English. No bullet lists. Do not invent figures.",
      toolName: "draft_narrative",
      toolDescription: "Draft the report narrative.",
      schema: NarrativeZ,
      maxTokens: 800,
      content: [{ type: "text", text: payload }],
    });
    return out.narrative;
  },
});
