import { v } from "convex/values";
import { z } from "zod";
import { action, query } from "./_generated/server";
import { api } from "./_generated/api";
import { getModelClient } from "../lib/model";
import { MODELS } from "../lib/llm";
import type { GrantTerms, Txn } from "../lib/types";
import { effectivePortions, withGlClaims, type TieOutDecision, type TieOutResolution } from "../lib/tieOut";
import { assertDemoPasscode } from "./passcode";

const NarrativeZ = z.object({ narrative: z.string().max(2000) });

export const grantReportData = query({
  args: { grantId: v.string() },
  handler: async (ctx, { grantId }) => {
    const [grants, decisions, rawTxns, entries, resolutions, glRows] = await Promise.all([
      ctx.db.query("grants").collect(),
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("proposedEntries").collect(),
      ctx.db.query("inboxResolutions").collect(),
      ctx.db.query("glRows").collect(),
    ]);
    const grant = grants.find((g) => (g.terms as GrantTerms | null)?.grantId === grantId);
    const terms = grant?.terms as GrantTerms | null;
    if (!terms) return null;

    const approved = new Set(entries.filter((e) => e.state === "approved").map((e) => e.txnId));
    const resolutionByTxn = new Map(resolutions.map((r) => [r.txnId, r]));
    const txns = withGlClaims(rawTxns as unknown as Txn[], glRows);
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    // A line counts once a person has dealt with it (approved entry or any inbox resolution) or it is clean.
    const included = (d: (typeof decisions)[number]) => d.status === "auto" || approved.has(d.txnId) || resolutionByTxn.has(d.txnId);
    const portions = (d: (typeof decisions)[number], t: (typeof txns)[number]) =>
      effectivePortions(t, { ...d, splits: d.splits as TieOutDecision["splits"] },
        resolutionByTxn.get(d.txnId) as TieOutResolution | undefined);

    const lines = terms.budgetLines.map((bl) => {
      let actual = 0;
      for (const d of decisions) {
        const t = byTxn.get(d.txnId);
        if (!t || t.amountCents >= 0) continue;
        if (!included(d)) continue;
        for (const s of portions(d, t)) {
          if (s.grantId === grantId && s.budgetLine === bl.code) actual += -s.amount;
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
      if (included(d)) return false;
      const t = byTxn.get(d.txnId);
      if (!t || t.amountCents >= 0) return false;
      if (d.grantId === grantId) return true;
      return (d.splits as { grantId: string | null }[] | undefined)?.some((s) => s.grantId === grantId) ?? false;
    });

    // Only this grant's share of a split line is pending, not the whole line.
    let excludedCents = 0;
    for (const d of excluded) {
      const t = byTxn.get(d.txnId)!;
      for (const s of portions(d, t)) if (s.grantId === grantId) excludedCents += -s.amount;
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
