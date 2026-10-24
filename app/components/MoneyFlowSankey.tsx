"use client";

import { sankey, sankeyLinkHorizontal, sankeyRight } from "d3-sankey";
import { useMemo, useState } from "react";
import { fmtRisk } from "../format";

type Outcome = "clean" | "needs_you" | "disallowed";

type LedgerRow = {
  amountCents: number;
  grantId: string | null;
  status: string;
};

const GRANT_LABELS: Record<string, string> = {
  "GA-2026-114": "GA-2026-114",
  "HLF-26-031": "HLF-26-031",
  unrestricted: "Unrestricted",
};

const OUTCOME_LABELS: Record<Outcome, string> = {
  clean: "Clean",
  needs_you: "Needs you",
  disallowed: "Disallowed",
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  clean: "var(--money)",
  needs_you: "var(--attention)",
  disallowed: "var(--redpen)",
};

export function MoneyFlowSankey({
  ledger,
  onOutcomeClick,
}: {
  ledger: LedgerRow[] | undefined;
  onOutcomeClick: (outcome: Outcome) => void;
}) {
  const [hover, setHover] = useState<{ label: string; cents: number; count: number } | null>(null);

  const { nodes, links, totalOut, summary } = useMemo(() => {
    const outflows = (ledger ?? []).filter((r) => r.amountCents < 0);
    const totalOut = outflows.reduce((a, r) => a + Math.abs(r.amountCents), 0);
    const bankGrant = new Map<string, number>();
    const grantOutcome = new Map<string, number>();
    const outcomeCount = new Map<string, number>();

    for (const r of outflows) {
      const cents = Math.abs(r.amountCents);
      const grant = r.grantId ?? "unrestricted";
      const outcome: Outcome =
        r.status === "auto" ? "clean" : r.status === "blocked" ? "disallowed" : "needs_you";
      const bg = `${grant}|${outcome}`;
      bankGrant.set(grant, (bankGrant.get(grant) ?? 0) + cents);
      grantOutcome.set(bg, (grantOutcome.get(bg) ?? 0) + cents);
      outcomeCount.set(outcome, (outcomeCount.get(outcome) ?? 0) + 1);
    }

    type N = { name: string; layer: number; outcome?: Outcome; grant?: string };
    const nodeList: N[] = [{ name: "Bank outflows", layer: 0 }];
    const grants = ["GA-2026-114", "HLF-26-031", "unrestricted"].filter(
      (g) => (bankGrant.get(g) ?? 0) > 0,
    );
    for (const g of grants) nodeList.push({ name: GRANT_LABELS[g] ?? g, layer: 1, grant: g });
    for (const o of ["clean", "needs_you", "disallowed"] as Outcome[]) {
      if ([...grantOutcome.keys()].some((k) => k.endsWith(`|${o}`))) {
        nodeList.push({ name: OUTCOME_LABELS[o], layer: 2, outcome: o });
      }
    }

    const idx = (name: string) => nodeList.findIndex((n) => n.name === name);
    const linkList: { source: number; target: number; value: number }[] = [];
    for (const [grant, cents] of bankGrant) {
      linkList.push({ source: idx("Bank outflows"), target: idx(GRANT_LABELS[grant] ?? grant), value: cents });
    }
    for (const [key, cents] of grantOutcome) {
      const [grant, outcome] = key.split("|") as [string, Outcome];
      linkList.push({
        source: idx(GRANT_LABELS[grant] ?? grant),
        target: idx(OUTCOME_LABELS[outcome]),
        value: cents,
      });
    }

    const nodesCopy = nodeList.map((d) => ({ ...d }));
    const linksCopy = linkList.map((d) => ({
      source: d.source,
      target: d.target,
      value: d.value,
    }));
    const layout = sankey<N, { source: number | N; target: number | N; value: number }>()
      .nodeWidth(14)
      .nodePadding(12)
      .extent([
        [8, 8],
        [520, 220],
      ])
      .nodeAlign(sankeyRight);

    const graph = layout({ nodes: nodesCopy, links: linksCopy });

    const cleanC = outcomeCount.get("clean") ?? 0;
    const needsC = outcomeCount.get("needs_you") ?? 0;
    const blockC = outcomeCount.get("disallowed") ?? 0;
    const summary = `Bank outflows ${fmtRisk(totalOut)} across ${outflows.length} charges: ${cleanC} clean, ${needsC} need review, ${blockC} disallowed.`;

    return { nodes: graph.nodes, links: graph.links, totalOut, summary };
  }, [ledger]);

  if (!ledger?.length || totalOut === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-[10px] border border-rule bg-sheet text-[15px] text-ink-2">
        No outflows to chart yet.
      </div>
    );
  }

  return (
    <div className="relative rounded-[10px] border border-rule bg-sheet p-4">
      <h3 className="font-display text-[17px] font-semibold text-ink">Where the money went</h3>
      <p className="sr-only">{summary}</p>
      {hover && (
        <p className="absolute right-4 top-4 text-[13px] text-ink-2" aria-live="polite">
          {hover.label}: {fmtRisk(hover.cents)} ({hover.count} items)
        </p>
      )}
      <svg viewBox="0 0 540 240" className="mt-2 w-full max-w-[540px]" role="img" aria-label={summary}>
        <defs>
          <linearGradient id="band-fade" x1="0%" x2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        {links.map((link, i) => {
          const target = link.target as { outcome?: Outcome; name: string };
          const color =
            target.outcome === "clean"
              ? OUTCOME_COLOR.clean
              : target.outcome === "needs_you"
                ? OUTCOME_COLOR.needs_you
                : target.outcome === "disallowed"
                  ? OUTCOME_COLOR.disallowed
                  : "var(--navy-2)";
          const clickable = target.outcome === "needs_you" || target.outcome === "disallowed";
          return (
            <path
              key={i}
              d={sankeyLinkHorizontal()(link) ?? ""}
              fill="none"
              stroke={color}
              strokeOpacity={0.55}
              strokeWidth={Math.max(1, link.width ?? 1)}
              className="sankey-band-animate"
              style={{ color, cursor: clickable ? "pointer" : undefined }}
              onClick={() => target.outcome && clickable && onOutcomeClick(target.outcome)}
              onMouseEnter={() =>
                setHover({
                  label: target.name,
                  cents: link.value ?? 0,
                  count: 1,
                })
              }
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {nodes.map((node, i) => (
          <g key={i} transform={`translate(${node.x0 ?? 0},${node.y0 ?? 0})`}>
            <rect
              width={(node.x1 ?? 0) - (node.x0 ?? 0)}
              height={(node.y1 ?? 0) - (node.y0 ?? 0)}
              fill={
                node.outcome
                  ? OUTCOME_COLOR[node.outcome]
                  : node.layer === 0
                    ? "var(--navy)"
                    : "var(--navy-2)"
              }
              rx={2}
            />
            <text
              x={-6}
              y={((node.y1 ?? 0) - (node.y0 ?? 0)) / 2}
              dy="0.35em"
              textAnchor="end"
              className="fill-ink text-[11px]"
            >
              {node.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
