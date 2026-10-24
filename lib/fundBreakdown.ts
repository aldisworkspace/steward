import { getFundLabel, grantTermsList } from "./fundLabels";
import {
  inboxCategory,
  matchesInboxFilter,
  MORE_FILTERS,
  PRIMARY_FILTERS,
  type InboxFilter,
} from "./inboxFilters";
import { isInboxResolved } from "./inboxResolved";
import type { GrantTerms } from "./types";

export type BreakdownSegment = "clean" | "needs_you" | "not_allowed";

export type FundBreakdownRow = {
  grantId: string | null;
  grantKey: string;
  title: string;
  subtitle: string;
  totalOutflowCents: number;
  cleanCents: number;
  needsYouCents: number;
  notAllowedCents: number;
  openCount: number;
  segmentCounts: Record<BreakdownSegment, number>;
};

export type FundBreakdownResult = {
  funds: FundBreakdownRow[];
  totals: {
    totalOutflowCents: number;
    cleanCents: number;
    needsYouCents: number;
    notAllowedCents: number;
  };
  chipCounts: Record<InboxFilter, number>;
  srSummary: string;
};

function grantKeyFromId(grantId: string | null): string {
  return grantId ?? "general";
}

function segmentForOpen(
  status: string,
  ruleId: string | null | undefined,
): "needs_you" | "not_allowed" {
  return inboxCategory(ruleId, status) === "not_allowed" ? "not_allowed" : "needs_you";
}

function fmtDollars(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function computeFundBreakdown(args: {
  transactions: { txnId: string; amountCents: number }[];
  decisions: {
    txnId: string;
    status: string;
    grantId: string | null;
    ruleHits: string[];
  }[];
  entries: { txnId: string; state: string }[];
  resolutionTxnIds: string[];
  grants: GrantTerms[] | { terms: unknown }[];
}): FundBreakdownResult | null {
  const terms = grantTermsList(args.grants);
  const byTxn = new Map(args.transactions.map((t) => [t.txnId, t]));
  const byDecision = new Map(args.decisions.map((d) => [d.txnId, d]));
  const resolvedTxnIds = new Set(args.resolutionTxnIds);

  const outflows = args.transactions.filter((t) => t.amountCents < 0);
  const totalOutflowCents = outflows.reduce((a, t) => a + Math.abs(t.amountCents), 0);
  if (!outflows.length || totalOutflowCents === 0) return null;

  type Acc = {
    totalOutflowCents: number;
    cleanCents: number;
    needsYouCents: number;
    notAllowedCents: number;
    openCount: number;
    segmentCounts: Record<BreakdownSegment, number>;
  };

  const acc = new Map<string, Acc>();
  const ensure = (gk: string) => {
    if (!acc.has(gk)) {
      acc.set(gk, {
        totalOutflowCents: 0,
        cleanCents: 0,
        needsYouCents: 0,
        notAllowedCents: 0,
        openCount: 0,
        segmentCounts: { clean: 0, needs_you: 0, not_allowed: 0 },
      });
    }
    return acc.get(gk)!;
  };

  let cleanCents = 0;
  let needsYouCents = 0;
  let notAllowedCents = 0;

  for (const t of outflows) {
    const d = byDecision.get(t.txnId);
    const status = d?.status ?? "auto";
    const ruleId = d?.ruleHits[0] ?? null;
    const grantId = d?.grantId ?? null;
    const gk = grantKeyFromId(grantId);
    const cents = Math.abs(t.amountCents);
    const row = ensure(gk);
    row.totalOutflowCents += cents;

    const resolved = isInboxResolved(t.txnId, args.entries, resolvedTxnIds);
    if (status === "auto" || resolved) {
      row.cleanCents += cents;
      cleanCents += cents;
      row.segmentCounts.clean += 1;
    } else {
      const openSeg = segmentForOpen(status, ruleId);
      row.segmentCounts[openSeg] += 1;
      if (openSeg === "not_allowed") {
        row.notAllowedCents += cents;
        notAllowedCents += cents;
      } else {
        row.needsYouCents += cents;
        needsYouCents += cents;
      }
    }
  }

  const openInboxItems = args.decisions
    .filter((d) => d.status !== "auto")
    .filter((d) => !isInboxResolved(d.txnId, args.entries, resolvedTxnIds))
    .map((d) => ({
      txnId: d.txnId,
      ruleId: d.ruleHits[0] ?? null,
      status: d.status,
      grantId: d.grantId,
    }));

  for (const item of openInboxItems) {
    const gk = grantKeyFromId(item.grantId);
    ensure(gk).openCount += 1;
  }

  const grantOrder = terms.map((t) => t.grantId);
  const keys = [...acc.keys()].sort((a, b) => {
    if (a === "general") return 1;
    if (b === "general") return -1;
    const ia = grantOrder.indexOf(a);
    const ib = grantOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  const funds: FundBreakdownRow[] = keys.map((gk) => {
    const grantId = gk === "general" ? null : gk;
    const fund = getFundLabel(grantId, terms);
    const a = acc.get(gk)!;
    return {
      grantId,
      grantKey: gk,
      title: fund.title,
      subtitle: fund.subtitle,
      ...a,
    };
  });

  const resolvedExceptionCount = args.decisions.filter((d) => d.status !== "auto").filter((d) =>
    isInboxResolved(d.txnId, args.entries, resolvedTxnIds),
  ).length;

  const chipFilters: InboxFilter[] = [...PRIMARY_FILTERS, ...MORE_FILTERS];
  const chipCounts = Object.fromEntries(
    chipFilters.map((f) => [
      f,
      f === "done"
        ? resolvedExceptionCount
        : f === "all"
          ? openInboxItems.length
          : openInboxItems.filter((r) => matchesInboxFilter(r.ruleId, r.status, f, false)).length,
    ]),
  ) as Record<InboxFilter, number>;
  chipCounts.needs_you = openInboxItems.filter((r) =>
    matchesInboxFilter(r.ruleId, r.status, "needs_you", false),
  ).length;

  const caption =
    needsYouCents === 0 && notAllowedCents === 0
      ? `${fmtDollars(cleanCents)} of ${fmtDollars(totalOutflowCents)} is coded cleanly.`
      : `${fmtDollars(cleanCents)} of ${fmtDollars(totalOutflowCents)} is coded cleanly. ${[
          needsYouCents > 0 ? `${fmtDollars(needsYouCents)} needs your review` : "",
          notAllowedCents > 0 ? `${fmtDollars(notAllowedCents)} isn't allowed under the grant agreements` : "",
        ]
          .filter(Boolean)
          .join(" and ")}.`;

  const srSummary = `Spent from the bank ${fmtDollars(totalOutflowCents)} across ${outflows.length} charges. ${caption}`;

  return {
    funds,
    totals: { totalOutflowCents, cleanCents, needsYouCents, notAllowedCents },
    chipCounts,
    srSummary,
  };
}

/** Sum of category chips (excluding all/done) must equal open count. */
export function verifyChipPartition(chipCounts: Record<InboxFilter, number>): {
  openAll: number;
  partitionSum: number;
  ok: boolean;
} {
  const openAll = chipCounts.all ?? 0;
  const cats: InboxFilter[] = ["not_allowed", "approval", "payroll", "books", "duplicate", "other"];
  const partitionSum = cats.reduce((a, f) => a + (chipCounts[f] ?? 0), 0);
  return { openAll, partitionSum, ok: openAll === partitionSum };
}
