import { v } from "convex/values";
import { query } from "./_generated/server";

const STATUS_RANK: Record<string, number> = { blocked: 0, needs_review: 1, auto: 2 };

export const dashboardStats = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns, glRows] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("glRows").collect(),
    ]);
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    const glByRef = new Map(glRows.map((g) => [g.bankRef, g]));
    const exceptions = decisions.filter((d) => d.status !== "auto");
    let atRiskCents = 0;
    for (const d of exceptions) {
      const t = byTxn.get(d.txnId);
      const g = glByRef.get(d.txnId);
      const chargedToGrant = g?.class ?? d.grantId;
      if (chargedToGrant && t) atRiskCents += Math.abs(t.amountCents);
    }
    return {
      total: decisions.length,
      clean: decisions.filter((d) => d.status === "auto").length,
      needYou: exceptions.length,
      atRiskCents,
      blocked: exceptions.filter((d) => d.status === "blocked").length,
      review: exceptions.filter((d) => d.status === "needs_review").length,
    };
  },
});

export const inboxQueue = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns, glRows, entries] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("glRows").collect(),
      ctx.db.query("proposedEntries").collect(),
    ]);
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    const glByRef = new Map(glRows.map((g) => [g.bankRef, g]));
    const entryByTxn = new Map(entries.filter((e) => e.state === "proposed").map((e) => [e.txnId, e]));
    const precedents = await ctx.db.query("precedents").collect();

    const rows = decisions
      .filter((d) => d.status !== "auto")
      .map((d) => {
        const t = byTxn.get(d.txnId);
        const g = glByRef.get(d.txnId);
        const reason =
          d.ruleHits[0] ??
          (d.rationale.split(".")[0]?.slice(0, 80) || d.rationale.slice(0, 80));
        const hasPrecedent = precedents.some((p) => p.ruling.includes(d.txnId) || p.scope.includes(d.txnId));
        return {
          txnId: d.txnId,
          status: d.status,
          amountCents: t?.amountCents ?? 0,
          description: t?.description ?? "",
          reason,
          hasEntry: !!entryByTxn.get(d.txnId),
          hasPrecedent,
          bookkeeperGrant: g?.class ?? null,
          bookkeeperLine: g?.budgetLine ?? null,
        };
      })
      .sort(
        (a, b) =>
          (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
          Math.abs(b.amountCents) - Math.abs(a.amountCents),
      );
    return rows;
  },
});

export const caseFile = query({
  args: { txnId: v.string() },
  handler: async (ctx, { txnId }) => {
    const [txn, decision, gl, grants, staff, entries] = await Promise.all([
      ctx.db.query("transactions").withIndex("by_txnId", (q) => q.eq("txnId", txnId)).first(),
      ctx.db.query("decisions").withIndex("by_txnId", (q) => q.eq("txnId", txnId)).first(),
      ctx.db.query("glRows").withIndex("by_bankRef", (q) => q.eq("bankRef", txnId)).first(),
      ctx.db.query("grants").collect(),
      ctx.db.query("staffAllocations").collect(),
      ctx.db.query("proposedEntries").collect(),
    ]);
    const entry = entries.find((e) => e.txnId === txnId && e.state === "proposed") ?? null;
    const grantTerms = grants
      .filter((g) => g.terms)
      .map((g) => ({ fileName: g.fileName, terms: g.terms }));
    return { txn, decision, gl, entry, grantTerms, staff };
  },
});

export const transactionLedger = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
    ]);
    const byTxn = new Map(decisions.map((d) => [d.txnId, d]));
    return txns
      .map((t) => {
        const d = byTxn.get(t.txnId);
        return {
          txnId: t.txnId,
          date: t.date,
          description: t.description,
          memo: t.memo,
          amountCents: t.amountCents,
          grantId: d?.grantId ?? null,
          budgetLine: d?.budgetLine ?? null,
          splits: d?.splits,
          status: d?.status ?? "auto",
          rationale: d?.rationale ?? "",
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId));
  },
});

export const grantsSheets = query({
  args: {},
  handler: async (ctx) => {
    const grants = await ctx.db.query("grants").collect();
    const decisions = await ctx.db.query("decisions").collect();
    const txns = await ctx.db.query("transactions").collect();
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));

    const spentByLine = new Map<string, number>();
    for (const d of decisions) {
      const t = byTxn.get(d.txnId);
      if (!t || t.amountCents >= 0) continue;
      const amt = Math.abs(t.amountCents);
      if (d.splits) {
        for (const s of d.splits as { grantId: string | null; budgetLine: string | null; amount: number }[]) {
          if (s.grantId && s.budgetLine) {
            const k = `${s.grantId}:${s.budgetLine}`;
            spentByLine.set(k, (spentByLine.get(k) ?? 0) + Math.abs(s.amount));
          }
        }
      } else if (d.grantId && d.budgetLine) {
        const k = `${d.grantId}:${d.budgetLine}`;
        spentByLine.set(k, (spentByLine.get(k) ?? 0) + amt);
      }
    }

    return grants.map((g) => {
      const gid = (g.terms as { grantId?: string } | null)?.grantId ?? "";
      return {
        _id: g._id,
        fileName: g.fileName,
        status: g.status,
        terms: g.terms,
        spentByLine: Object.fromEntries([...spentByLine.entries()].filter(([k]) => k.startsWith(gid))),
      };
    });
  },
});

export const auditFeed = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("auditLog").order("desc").take(80);
    return rows;
  },
});
