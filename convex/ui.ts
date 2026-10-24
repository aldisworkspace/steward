import { v } from "convex/values";
import { query } from "./_generated/server";
import { computeFundBreakdown } from "../lib/fundBreakdown";
import { computeInboxOpenMetrics } from "../lib/inboxOpenMetrics";
import { isInboxResolved } from "../lib/inboxResolved";
import { ruleLabel } from "../lib/ruleLabels";

const STATUS_RANK: Record<string, number> = { blocked: 0, needs_review: 1, auto: 2 };

export const inboxBadge = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns, entries, resolutions] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("proposedEntries").collect(),
      ctx.db.query("inboxResolutions").collect(),
    ]);
    const resolvedTxnIds = new Set(resolutions.map((r) => r.txnId));
    return computeInboxOpenMetrics({
      decisions,
      transactions: txns.map((t) => ({ txnId: t.txnId, amountCents: t.amountCents })),
      entries: entries.map((e) => ({ txnId: e.txnId, state: e.state })),
      resolutionTxnIds: resolvedTxnIds,
    });
  },
});

export const dashboardStats = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns, entries, resolutions] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("proposedEntries").collect(),
      ctx.db.query("inboxResolutions").collect(),
    ]);
    const resolvedTxnIds = new Set(resolutions.map((r) => r.txnId));
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    const exceptions = decisions.filter((d) => d.status !== "auto");
    const openExceptions = exceptions.filter(
      (d) => !isInboxResolved(d.txnId, entries, resolvedTxnIds),
    );
    const { atRiskCents } = computeInboxOpenMetrics({
      decisions,
      transactions: txns.map((t) => ({ txnId: t.txnId, amountCents: t.amountCents })),
      entries: entries.map((e) => ({ txnId: e.txnId, state: e.state })),
      resolutionTxnIds: resolvedTxnIds,
    });
    const breakdown: { label: string; cents: number }[] = [];
    const breakdownMap = new Map<string, number>();
    for (const d of openExceptions) {
      const t = byTxn.get(d.txnId);
      if (!t || t.amountCents >= 0) continue;
      const risk = d.atRiskCents ?? 0;
      if (risk <= 0) continue;
      const label = d.ruleHits[0] ? ruleLabel(d.ruleHits[0]) : "Steward's judgment";
      breakdownMap.set(label, (breakdownMap.get(label) ?? 0) + risk);
    }
    for (const [label, cents] of breakdownMap) breakdown.push({ label, cents });
    breakdown.sort((a, b) => b.cents - a.cents);
    return {
      total: decisions.length,
      clean: decisions.filter((d) => d.status === "auto").length,
      needYou: openExceptions.length,
      resolved: exceptions.length - openExceptions.length,
      atRiskCents,
      atRiskBreakdown: breakdown,
      blocked: openExceptions.filter((d) => d.status === "blocked").length,
      review: openExceptions.filter((d) => d.status === "needs_review").length,
    };
  },
});

export const fundBreakdown = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns, entries, resolutions, grants] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("proposedEntries").collect(),
      ctx.db.query("inboxResolutions").collect(),
      ctx.db.query("grants").collect(),
    ]);
    const grantTerms = grants.filter((g) => g.terms).map((g) => g.terms);
    return computeFundBreakdown({
      transactions: txns.map((t) => ({ txnId: t.txnId, amountCents: t.amountCents })),
      decisions: decisions.map((d) => ({
        txnId: d.txnId,
        status: d.status,
        grantId: d.grantId,
        ruleHits: d.ruleHits,
      })),
      entries: entries.map((e) => ({ txnId: e.txnId, state: e.state })),
      resolutionTxnIds: resolutions.map((r) => r.txnId),
      grants: grantTerms,
    });
  },
});

export const inboxQueue = query({
  args: {},
  handler: async (ctx) => {
    const [decisions, txns, glRows, entries, resolutions, staffRows] = await Promise.all([
      ctx.db.query("decisions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("glRows").collect(),
      ctx.db.query("proposedEntries").collect(),
      ctx.db.query("inboxResolutions").collect(),
      ctx.db.query("staffAllocations").collect(),
    ]);
    const resolvedTxnIds = new Set(resolutions.map((r) => r.txnId));
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    const glByRef = new Map(glRows.map((g) => [g.bankRef, g]));
    const entryByTxn = new Map(entries.filter((e) => e.state === "proposed").map((e) => [e.txnId, e]));
    const precedents = await ctx.db.query("precedents").collect();

    const rows = decisions
      .filter((d) => d.status !== "auto")
      .filter((d) => !isInboxResolved(d.txnId, entries, resolvedTxnIds))
      .map((d) => {
        const t = byTxn.get(d.txnId);
        const g = glByRef.get(d.txnId);
        const checks = d.checks as { label: string }[] | undefined;
        const ruleId = d.ruleHits[0] ?? null;
        const reason =
          (ruleId ? ruleLabel(ruleId) : checks?.[0]?.label) ??
          (d.modelRationale ?? d.rationale).split(".")[0] ??
          "Needs review";
        const hasPrecedent = precedents.some((p) => p.ruling.includes(d.txnId) || p.scope.includes(d.txnId));
        const proposed = entryByTxn.get(d.txnId);
        const memo = t?.memo ?? "";
        const hay = `${t?.description ?? ""} ${memo}`.toLowerCase();
        let employee: string | null = null;
        for (const s of staffRows) {
          const full = s.employee.trim();
          if (full && hay.includes(full.toLowerCase())) {
            employee = full;
            break;
          }
          const last = full.split(/\s+/).pop();
          if (last && last.length >= 2 && hay.includes(last.toLowerCase())) {
            employee = full;
            break;
          }
        }
        return {
          txnId: d.txnId,
          status: d.status,
          grantId: d.grantId,
          amountCents: t?.amountCents ?? 0,
          description: t?.description ?? "",
          memo,
          atRiskCents: d.atRiskCents ?? 0,
          reason,
          ruleId,
          employee,
          hasEntry: !!proposed,
          entryId: proposed?.id ?? null,
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

export const inboxResolved = query({
  args: {},
  handler: async (ctx) => {
    const [resolutions, txns, decisions] = await Promise.all([
      ctx.db.query("inboxResolutions").collect(),
      ctx.db.query("transactions").collect(),
      ctx.db.query("decisions").collect(),
    ]);
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    const byDecision = new Map(decisions.map((d) => [d.txnId, d]));
    return resolutions
      .map((r) => {
        const t = byTxn.get(r.txnId);
        const d = byDecision.get(r.txnId);
        return {
          txnId: r.txnId,
          status: d?.status ?? "needs_review",
          grantId: d?.grantId ?? null,
          amountCents: t?.amountCents ?? 0,
          description: t?.description ?? "",
          reason: r.resolution === "acknowledged" ? "Acknowledged" : "Overridden",
          ruleId: d?.ruleHits[0] ?? null,
          entryId: null,
          resolved: true as const,
          resolvedAt: r.at,
        };
      })
      .sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
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
    const entries = await ctx.db.query("proposedEntries").collect();
    const byTxn = new Map(txns.map((t) => [t.txnId, t]));
    const approved = new Set(entries.filter((e) => e.state === "approved").map((e) => e.txnId));

    const spentByLine = new Map<string, number>();
    for (const d of decisions) {
      const t = byTxn.get(d.txnId);
      if (!t || t.amountCents >= 0) continue;
      if (d.status !== "auto" && !approved.has(d.txnId)) continue;
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
      const terms = g.terms as {
        grantId?: string;
        budgetLines?: { code: string; amount: number }[];
        lineVarianceLimitPct?: number | null;
      } | null;
      const gid = terms?.grantId ?? "";
      const lineMeta: Record<string, { overCents: number; overPct: number }> = {};
      for (const bl of terms?.budgetLines ?? []) {
        const spent = spentByLine.get(`${gid}:${bl.code}`) ?? 0;
        const budget = Math.round(bl.amount * 100);
        const cap = terms?.lineVarianceLimitPct
          ? Math.round(budget * (1 + terms.lineVarianceLimitPct / 100))
          : budget;
        if (spent > cap) {
          lineMeta[`${gid}:${bl.code}`] = {
            overCents: spent - cap,
            overPct: cap ? Math.round(((spent - cap) / cap) * 100) : 0,
          };
        }
      }
      return {
        _id: g._id,
        fileName: g.fileName,
        status: g.status,
        terms: g.terms,
        spentByLine: Object.fromEntries([...spentByLine.entries()].filter(([k]) => k.startsWith(gid))),
        lineMeta,
      };
    });
  },
});

export const auditFeed = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("auditLog").order("desc").take(80);
    const hide = new Set(["decision", "defend_decision", "challenge"]);
    const summaries = rows.filter((r) => r.action === "run_summary");
    if (summaries.length) {
      const other = rows.filter((r) => !hide.has(r.action) && r.action !== "run_summary");
      return [...summaries, ...other].slice(0, 40);
    }
    return rows.filter((r) => !hide.has(r.action));
  },
});
