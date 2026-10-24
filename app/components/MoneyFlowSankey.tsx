"use client";

import { getFundLabel, grantTermsList } from "@/lib/fundLabels";
import type { GrantTerms } from "@/lib/types";
import { sankey, sankeyLinkHorizontal, sankeyRight } from "d3-sankey";
import { useMemo, useState } from "react";
import { fmtRisk } from "../format";

type Outcome = "clean" | "needs_you" | "disallowed";

type LedgerRow = {
  amountCents: number;
  grantId: string | null;
  status: string;
};

export type SankeyNavigate =
  | { kind: "fund"; grantId: string | null }
  | { kind: "status"; outcome: Outcome; grantId: string | null };

type NodeMeta = {
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

const OUTCOME_LABEL: Record<Outcome, string> = {
  clean: "Clean",
  needs_you: "Needs you",
  disallowed: "Disallowed",
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  clean: "var(--money)",
  needs_you: "var(--attention)",
  disallowed: "var(--redpen)",
};

const OUTCOME_HINT: Record<Outcome, string> = {
  clean: "Coded and verified against grant rules; no action required.",
  needs_you: "Steward needs your approval or judgment before books are final.",
  disallowed: "Costs the grant agreement prohibits; Steward moved them to general funds.",
};

function grantKeyFromId(grantId: string | null): string {
  return grantId ?? "general";
}

function grantIdFromKey(key: string): string | null {
  return key === "general" ? null : key;
}

export function MoneyFlowSankey({
  ledger,
  grants,
  onNavigate,
}: {
  ledger: LedgerRow[] | undefined;
  grants: GrantTerms[] | { terms: unknown }[] | undefined;
  onNavigate: (nav: SankeyNavigate) => void;
}) {
  const terms = grantTermsList(grants);
  const [hover, setHover] = useState<{
    title: string;
    subtitle: string;
    cents: number;
    count: number;
    hint?: string;
  } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<number | null>(null);

  const graph = useMemo(() => {
    const outflows = (ledger ?? []).filter((r) => r.amountCents < 0);
    const totalOut = outflows.reduce((a, r) => a + Math.abs(r.amountCents), 0);
    const bankGrant = new Map<string, number>();
    const grantOutcome = new Map<string, number>();
    const grantCount = new Map<string, number>();
    const outcomeCount = new Map<string, number>();
    const linkCounts = new Map<string, number>();

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
    }

    const nodeList: NodeMeta[] = [
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

    const idx = (id: string) => nodeList.findIndex((n) => n.id === id);
    const linkList: { source: string; target: string; value: number; count: number; grantKey: string | null; outcome: Outcome }[] = [];

    for (const [gk, cents] of bankGrant) {
      linkList.push({
        source: "bank",
        target: `fund-${gk}`,
        value: cents,
        count: grantCount.get(gk) ?? 0,
        grantKey: grantIdFromKey(gk),
        outcome: "clean",
      });
    }
    for (const [key, cents] of grantOutcome) {
      const [gk, outcome] = key.split("|") as [string, Outcome];
      linkList.push({
        source: `fund-${gk}`,
        target: `status-${outcome}`,
        value: cents,
        count: linkCounts.get(key) ?? 0,
        grantKey: grantIdFromKey(gk),
        outcome,
      });
    }

    type N = NodeMeta & { x0?: number; x1?: number; y0?: number; y1?: number };
    type L = { source: number | N; target: number | N; value: number; grantKey: string | null; outcome: Outcome; count: number };

    const nodesCopy: N[] = nodeList.map((d) => ({ ...d }));
    const linksCopy: L[] = linkList.map((d) => ({
      source: idx(d.source),
      target: idx(d.target),
      value: d.value,
      grantKey: d.grantKey,
      outcome: d.outcome,
      count: d.count,
    }));

    const layout = sankey<N, L>()
      .nodeWidth(14)
      .nodePadding(14)
      .extent([
        [12, 12],
        [528, 228],
      ])
      .nodeAlign(sankeyRight);

    const laid = layout({ nodes: nodesCopy, links: linksCopy });

    let cleanC = 0;
    let problemC = 0;
    const problemByGrant = new Map<string, number>();
    for (const r of outflows) {
      const cents = Math.abs(r.amountCents);
      const gk = grantKeyFromId(r.grantId);
      if (r.status === "auto") cleanC += cents;
      else {
        problemC += cents;
        problemByGrant.set(gk, (problemByGrant.get(gk) ?? 0) + cents);
      }
    }

    let caption: string;
    if (problemC === 0) {
      caption = "All spending on the bank feed is coded clean.";
    } else {
      const top = [...problemByGrant.entries()].sort((a, b) => b[1] - a[1])[0];
      const topFund = getFundLabel(grantIdFromKey(top?.[0] ?? "general"), terms);
      caption = `Most spending is clean. ${fmtRisk(problemC)} is charged to the wrong fund or not allowed${topFund.title ? `, mostly on the ${topFund.title} grant` : ""}.`;
    }

    const srSummary = `Spent from the bank ${fmtRisk(totalOut)} across ${outflows.length} charges. ${caption}`;

    return { nodes: laid.nodes, links: laid.links, totalOut, caption, srSummary, outflows: outflows.length };
  }, [ledger, terms]);

  if (!ledger?.length || graph.totalOut === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-[8px] border border-rule bg-sheet text-[15px] text-ink-2">
        No outflows to chart yet.
      </div>
    );
  }

  return (
    <div className="relative rounded-[8px] border border-rule bg-sheet p-4">
      <h3 className="font-display text-[17px] font-semibold text-ink">Where the money went</h3>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px] font-medium text-ink-2">
        <span>Spent from the bank</span>
        <span className="text-center">Charged to</span>
        <span className="text-right">Status</span>
      </div>
      <p className="sr-only">{graph.srSummary}</p>
      {hover && (
        <div
          className="absolute right-4 top-14 z-10 max-w-[240px] rounded-[8px] border border-rule bg-sheet p-3 text-[13px] shadow-[0_4px_24px_rgba(14,27,44,0.12)]"
          aria-live="polite"
        >
          <p className="font-semibold text-ink">{hover.title}</p>
          {hover.subtitle && <p className="text-ink-2">{hover.subtitle}</p>}
          <p className="tabular mt-1 font-medium">{fmtRisk(hover.cents)}</p>
          <p className="text-ink-2">{hover.count} transaction{hover.count === 1 ? "" : "s"}</p>
          {hover.hint && <p className="mt-2 text-ink-2">{hover.hint}</p>}
        </div>
      )}
      <svg viewBox="0 0 540 260" className="mt-1 w-full max-w-[540px]" role="img" aria-label={graph.srSummary}>
        {graph.links.map((link, i) => {
          const target = link.target as NodeMeta;
          const source = link.source as NodeMeta;
          const color = target.outcome ? OUTCOME_COLOR[target.outcome] : "var(--navy-2)";
          const active = hoverLink === i || focusId === target.id || focusId === source.id;
          const dimmed = (hover || hoverLink !== null || focusId) && !active;
          const grantKey = link.grantKey;
          const outcome = target.outcome ?? link.outcome;
          return (
            <path
              key={`link-${i}`}
              d={sankeyLinkHorizontal()(link) ?? ""}
              fill="none"
              stroke={color}
              strokeOpacity={dimmed ? 0.15 : 0.55}
              strokeWidth={Math.max(1, link.width ?? 1)}
              className="sankey-band-animate cursor-pointer transition-[stroke-opacity] duration-150"
              onClick={() => {
                if (source.kind === "bank" && target.kind === "fund") {
                  onNavigate({ kind: "fund", grantId: target.grantKey });
                } else if (target.kind === "status") {
                  onNavigate({ kind: "status", outcome, grantId: grantKey });
                }
              }}
              onMouseEnter={() => {
                setHoverLink(i);
                setHover({
                  title: target.title,
                  subtitle: target.subtitle,
                  cents: link.value ?? 0,
                  count: link.count,
                  hint: target.outcome ? OUTCOME_HINT[target.outcome] : undefined,
                });
              }}
              onMouseLeave={() => {
                setHoverLink(null);
                setHover(null);
              }}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const w = (node.x1 ?? 0) - (node.x0 ?? 0);
          const h = (node.y1 ?? 0) - (node.y0 ?? 0);
          const active = focusId === node.id || hover?.title === node.title;
          const dimmed = (hover || focusId) && !active;
          const fill =
            node.outcome != null
              ? OUTCOME_COLOR[node.outcome]
              : node.kind === "bank"
                ? "var(--navy)"
                : "var(--navy-2)";
          const labelX = node.layer === 2 ? (node.x1 ?? 0) + 8 : (node.x0 ?? 0) - 8;
          const anchor = node.layer === 2 ? "start" : "end";

          function activate() {
            if (node.kind === "fund") onNavigate({ kind: "fund", grantId: node.grantKey });
            if (node.kind === "status" && node.outcome) {
              onNavigate({ kind: "status", outcome: node.outcome, grantId: null });
            }
          }

          return (
            <g key={node.id} transform={`translate(${node.x0 ?? 0},${node.y0 ?? 0})`}>
              <rect
                width={w}
                height={h}
                fill={fill}
                opacity={dimmed ? 0.35 : 1}
                rx={2}
                className={node.kind !== "bank" ? "cursor-pointer" : undefined}
                role={node.kind !== "bank" ? "button" : undefined}
                tabIndex={node.kind !== "bank" ? 0 : undefined}
                aria-label={`${node.title}, ${fmtRisk(node.cents)}, ${node.count} transactions`}
                onClick={node.kind !== "bank" ? activate : undefined}
                onKeyDown={(e) => {
                  if (node.kind === "bank") return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate();
                  }
                }}
                onFocus={() => setFocusId(node.id)}
                onBlur={() => setFocusId(null)}
                onMouseEnter={() =>
                  setHover({
                    title: node.title,
                    subtitle: node.subtitle,
                    cents: node.cents,
                    count: node.count,
                    hint: node.outcome ? OUTCOME_HINT[node.outcome] : undefined,
                  })
                }
                onMouseLeave={() => setHover(null)}
              />
              <text
                x={labelX - (node.x0 ?? 0)}
                y={h / 2}
                dy="-0.4em"
                textAnchor={anchor}
                className="fill-ink text-[14px] font-semibold pointer-events-none"
              >
                {node.title}
              </text>
              <text
                x={labelX - (node.x0 ?? 0)}
                y={h / 2}
                dy="0.85em"
                textAnchor={anchor}
                className="fill-ink-2 tabular text-[13px] pointer-events-none"
              >
                {fmtRisk(node.cents)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-3 max-w-[52ch] text-[14px] text-ink-2">{graph.caption}</p>
    </div>
  );
}
