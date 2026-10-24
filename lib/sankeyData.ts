import { getFundLabel, grantTermsList } from "./fundLabels";
import type { GrantTerms } from "./types";

export type Outcome = "clean" | "needs_you" | "disallowed";

export type LedgerRow = {
  amountCents: number;
  grantId: string | null;
  status: string;
};

export type SankeyNodeMeta = {
  id: string;
  layer: number;
  title: string;
  subtitle: string;
  cents: number;
  count: number;
  grantKey: string | null;
  outcome?: Outcome;
  kind: "bank" | "fund" | "status";
};

export type SankeyLinkMeta = {
  id: string;
  sourceId: string;
  targetId: string;
  value: number;
  count: number;
  grantKey: string | null;
  outcome: Outcome;
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  clean: "Clean",
  needs_you: "Needs you",
  disallowed: "Disallowed",
};

export const OUTCOME_COLOR: Record<Outcome, string> = {
  clean: "var(--money)",
  needs_you: "var(--attention)",
  disallowed: "var(--redpen)",
};

export const OUTCOME_HINT: Record<Outcome, string> = {
  clean: "Coded and verified against grant rules; no action required.",
  needs_you: "Steward needs your approval or judgment before books are final.",
  disallowed: "Costs the grant agreement prohibits; Steward moved them to general funds.",
};

export function grantKeyFromId(grantId: string | null): string {
  return grantId ?? "general";
}

export function grantIdFromKey(key: string): string | null {
  return key === "general" ? null : key;
}

export type SankeyAggregates = {
  nodeList: SankeyNodeMeta[];
  linkList: SankeyLinkMeta[];
  totalOut: number;
  outflowCount: number;
  cleanCents: number;
  needsCents: number;
  disallowedCents: number;
  nonCleanByGrant: Map<string, number>;
  fundBreakdown: {
    grantKey: string;
    grantId: string | null;
    title: string;
    clean: number;
    needs_you: number;
    disallowed: number;
    total: number;
  }[];
  caption: string;
  srSummary: string;
};

function fmtDollars(cents: number): string {
  const n = Math.abs(cents) / 100;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function buildSankeyAggregates(
  ledger: LedgerRow[] | undefined,
  grants: GrantTerms[] | { terms: unknown }[] | undefined,
): SankeyAggregates | null {
  const terms = grantTermsList(grants);
  const outflows = (ledger ?? []).filter((r) => r.amountCents < 0);
  const totalOut = outflows.reduce((a, r) => a + Math.abs(r.amountCents), 0);
  if (!outflows.length || totalOut === 0) return null;

  const bankGrant = new Map<string, number>();
  const grantOutcome = new Map<string, number>();
  const grantCount = new Map<string, number>();
  const outcomeCount = new Map<string, number>();
  const linkCounts = new Map<string, number>();
  let cleanCents = 0;
  let needsCents = 0;
  let disallowedCents = 0;
  const nonCleanByGrant = new Map<string, number>();

  for (const r of outflows) {
    const cents = Math.abs(r.amountCents);
    const gk = grantKeyFromId(r.grantId);
    const outcome: Outcome =
      r.status === "auto" ? "clean" : r.status === "blocked" ? "disallowed" : "needs_you";
    const bg = `${gk}|${outcome}`;
    bankGrant.set(gk, (bankGrant.get(gk) ?? 0) + cents);
    grantOutcome.set(bg, (grantOutcome.get(bg) ?? 0) + cents);
    grantCount.set(gk, (grantCount.get(gk) ?? 0) + 1);
    outcomeCount.set(outcome, (outcomeCount.get(outcome) ?? 0) + 1);
    linkCounts.set(bg, (linkCounts.get(bg) ?? 0) + 1);
    if (outcome === "clean") cleanCents += cents;
    else if (outcome === "needs_you") needsCents += cents;
    else disallowedCents += cents;
    if (outcome !== "clean") {
      nonCleanByGrant.set(gk, (nonCleanByGrant.get(gk) ?? 0) + cents);
    }
  }

  const nodeList: SankeyNodeMeta[] = [
    {
      id: "bank",
      layer: 0,
      title: "Bank outflows",
      subtitle: "All charges on the feed",
      cents: totalOut,
      count: outflows.length,
      grantKey: null,
      kind: "bank",
    },
  ];

  const fundKeys = [...bankGrant.keys()].sort();
  for (const gk of fundKeys) {
    const gid = grantIdFromKey(gk);
    const fund = getFundLabel(gid, terms);
    nodeList.push({
      id: `fund-${gk}`,
      layer: 1,
      title: fund.title,
      subtitle: fund.subtitle,
      cents: bankGrant.get(gk) ?? 0,
      count: grantCount.get(gk) ?? 0,
      grantKey: gid,
      kind: "fund",
    });
  }

  for (const o of ["clean", "needs_you", "disallowed"] as Outcome[]) {
    const cents = [...grantOutcome.entries()]
      .filter(([k]) => k.endsWith(`|${o}`))
      .reduce((a, [, v]) => a + v, 0);
    if (cents <= 0) continue;
    nodeList.push({
      id: `status-${o}`,
      layer: 2,
      title: OUTCOME_LABEL[o],
      subtitle: OUTCOME_HINT[o].split(";")[0] ?? "",
      cents,
      count: outcomeCount.get(o) ?? 0,
      grantKey: null,
      outcome: o,
      kind: "status",
    });
  }

  const linkList: SankeyLinkMeta[] = [];
  let linkIdx = 0;
  for (const [gk, cents] of bankGrant) {
    linkList.push({
      id: `link-${linkIdx++}`,
      sourceId: "bank",
      targetId: `fund-${gk}`,
      value: cents,
      count: grantCount.get(gk) ?? 0,
      grantKey: grantIdFromKey(gk),
      outcome: "clean",
    });
  }
  for (const [key, cents] of grantOutcome) {
    const [gk, outcome] = key.split("|") as [string, Outcome];
    linkList.push({
      id: `link-${linkIdx++}`,
      sourceId: `fund-${gk}`,
      targetId: `status-${outcome}`,
      value: cents,
      count: linkCounts.get(key) ?? 0,
      grantKey: grantIdFromKey(gk),
      outcome,
    });
  }

  const fundBreakdown = fundKeys.map((gk) => {
    const gid = grantIdFromKey(gk);
    const clean = grantOutcome.get(`${gk}|clean`) ?? 0;
    const needs_you = grantOutcome.get(`${gk}|needs_you`) ?? 0;
    const disallowed = grantOutcome.get(`${gk}|disallowed`) ?? 0;
    return {
      grantKey: gk,
      grantId: gid,
      title: getFundLabel(gid, terms).title,
      clean,
      needs_you,
      disallowed,
      total: bankGrant.get(gk) ?? 0,
    };
  });

  let caption: string;
  const clean = fmtDollars(cleanCents);
  const total = fmtDollars(totalOut);
  if (needsCents === 0 && disallowedCents === 0) {
    caption = `${clean} of ${total} is coded cleanly.`;
  } else {
    const parts: string[] = [`${clean} of ${total} is coded cleanly.`];
    const mid: string[] = [];
    if (needsCents > 0) mid.push(`${fmtDollars(needsCents)} needs your review`);
    if (disallowedCents > 0) mid.push(`${fmtDollars(disallowedCents)} isn't allowed under the grant agreements`);
    let tail = "";
    const top = [...nonCleanByGrant.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 0) {
      const gid = grantIdFromKey(top[0]);
      if (gid === null) tail = ", most of it in general funds";
      else tail = `, most of it on ${getFundLabel(gid, terms).title}`;
    }
    caption = `${parts[0]} ${mid.join(" and ")}${tail}.`;
  }

  const srSummary = `Spent from the bank ${total} across ${outflows.length} charges. ${caption}`;

  return {
    nodeList,
    linkList,
    totalOut,
    outflowCount: outflows.length,
    cleanCents,
    needsCents,
    disallowedCents,
    nonCleanByGrant,
    fundBreakdown,
    caption,
    srSummary,
  };
}
