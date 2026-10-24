import { query } from "./_generated/server";

const STATUS_RANK: Record<string, number> = { blocked: 0, needs_review: 1, auto: 2 };

export const listDecisions = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
    ]);
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    return decisions
      .map((d) => {
        const t = byTxn.get(d.txnId);
        return {
          txnId: d.txnId,
          date: t?.date ?? "",
          description: t?.description ?? "",
          amountCents: t?.amountCents ?? 0,
          grantId: d.grantId,
          budgetLine: d.budgetLine,
          status: d.status,
          rationale: d.rationale,
        };
      })
      .sort(
        (a, b) =>
          (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
          a.txnId.localeCompare(b.txnId),
      );
  },
});

export const latestRun = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").order("desc").take(1);
    return runs[0] ?? null;
  },
});

export const listDecisionsRaw = query({
  args: {},
  handler: async (ctx) => ctx.db.query("decisions").collect(),
});
