"use client";

import {
  buildSankeyAggregates,
  grantIdFromKey,
  OUTCOME_COLOR,
  OUTCOME_HINT,
  type Outcome,
  type SankeyLinkMeta,
  type SankeyNodeMeta,
} from "@/lib/sankeyData";
import type { GrantTerms } from "@/lib/types";
import { sankey, sankeyLinkHorizontal, sankeyRight } from "d3-sankey";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtRisk } from "../format";

type LedgerRow = {
  amountCents: number;
  grantId: string | null;
  status: string;
};

export type SankeyNavigate =
  | { kind: "fund"; grantId: string | null }
  | { kind: "status"; outcome: Outcome; grantId: string | null };

const MIN_CHART_WIDTH = 720;
const LEFT_LANE = 170;
const RIGHT_LANE = 190;
const CHART_HEIGHT = 280;
const TOP_PAD = 24;
const BOTTOM_PAD = 16;
const FUND_BLOCK_W = 168;
const LABEL_BLOCK_H = 36;
const LABEL_GAP = 8;
const MIN_NODE_HIT = 6;

type LayoutNode = SankeyNodeMeta & { x0?: number; x1?: number; y0?: number; y1?: number };
type LayoutLink = {
  source: number | LayoutNode;
  target: number | LayoutNode;
  value: number;
  id: string;
  grantKey: string | null;
  outcome: Outcome;
  count: number;
};

type LaneLabel = {
  id: string;
  title: string;
  amount: string;
  x: number;
  anchor: "end" | "start";
  y: number;
  nodeCy: number;
  nodeCx: number;
  leader: boolean;
  kind: SankeyNodeMeta["kind"];
  grantKey: string | null;
  outcome?: Outcome;
  subtitle: string;
  count: number;
  cents: number;
};

function stackLaneLabels(
  items: Omit<LaneLabel, "y" | "leader">[],
  chartTop: number,
  chartBottom: number,
): LaneLabel[] {
  const sorted = [...items].sort((a, b) => a.nodeCy - b.nodeCy);
  const placed: LaneLabel[] = [];
  let cursor = chartTop;
  for (const item of sorted) {
    let y = item.nodeCy - LABEL_BLOCK_H / 2;
    if (y < cursor) y = cursor;
    const leader = Math.abs(y + LABEL_BLOCK_H / 2 - item.nodeCy) > 6;
    placed.push({ ...item, y, leader });
    cursor = y + LABEL_BLOCK_H + LABEL_GAP;
  }
  const overflow = cursor - LABEL_GAP - chartBottom;
  if (overflow > 0) {
    for (const p of placed) p.y -= overflow;
  }
  return placed;
}

function runLayout(width: number, agg: NonNullable<ReturnType<typeof buildSankeyAggregates>>) {
  const idx = (id: string) => agg.nodeList.findIndex((n) => n.id === id);
  const nodesCopy: LayoutNode[] = agg.nodeList.map((d) => ({ ...d }));
  const linksCopy: LayoutLink[] = agg.linkList.map((d) => ({
    source: idx(d.sourceId),
    target: idx(d.targetId),
    value: d.value,
    id: d.id,
    grantKey: d.grantKey,
    outcome: d.outcome,
    count: d.count,
  }));

  const layout = sankey<LayoutNode, LayoutLink>()
    .nodeWidth(10)
    .nodePadding(18)
    .extent([
      [LEFT_LANE, TOP_PAD],
      [width - RIGHT_LANE, CHART_HEIGHT - BOTTOM_PAD],
    ])
    .nodeAlign(sankeyRight);

  const graph = layout({ nodes: nodesCopy, links: linksCopy });
  for (const node of graph.nodes) {
    if (node.kind === "fund") {
      const cx = ((node.x0 ?? 0) + (node.x1 ?? 0)) / 2;
      node.x0 = cx - FUND_BLOCK_W / 2;
      node.x1 = cx + FUND_BLOCK_W / 2;
    }
  }
  layout.update(graph);
  const { nodes, links } = graph;

  const chartBottom = CHART_HEIGHT - BOTTOM_PAD;
  const leftItems: Omit<LaneLabel, "y" | "leader">[] = [];
  const rightItems: Omit<LaneLabel, "y" | "leader">[] = [];

  for (const node of nodes) {
    const cy = ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2;
    const cx = ((node.x0 ?? 0) + (node.x1 ?? 0)) / 2;
    if (node.kind === "bank") {
      leftItems.push({
        id: node.id,
        title: node.title,
        amount: fmtRisk(node.cents),
        x: LEFT_LANE - 12,
        anchor: "end",
        nodeCy: cy,
        nodeCx: cx,
        kind: node.kind,
        grantKey: node.grantKey,
        outcome: node.outcome,
        subtitle: node.subtitle,
        count: node.count,
        cents: node.cents,
      });
    }
    if (node.kind === "status") {
      rightItems.push({
        id: node.id,
        title: node.title,
        amount: fmtRisk(node.cents),
        x: (node.x1 ?? width - RIGHT_LANE) + 12,
        anchor: "start",
        nodeCy: cy,
        nodeCx: cx,
        kind: node.kind,
        grantKey: node.grantKey,
        outcome: node.outcome,
        subtitle: node.subtitle,
        count: node.count,
        cents: node.cents,
      });
    }
  }

  const leftLabels = stackLaneLabels(leftItems, TOP_PAD, chartBottom);
  const rightLabels = stackLaneLabels(rightItems, TOP_PAD, chartBottom);

  return { nodes, links, leftLabels, rightLabels, width, height: CHART_HEIGHT };
}

type HitPayload = {
  title: string;
  subtitle: string;
  cents: number;
  count: number;
  hint?: string;
};

export function MoneyFlowSankey({
  ledger,
  grants,
  onNavigate,
}: {
  ledger: LedgerRow[] | undefined;
  grants: GrantTerms[] | { terms: unknown }[] | undefined;
  onNavigate: (nav: SankeyNavigate) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatedRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const agg = useMemo(() => buildSankeyAggregates(ledger, grants), [ledger, grants]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layoutWidth = Math.max(MIN_CHART_WIDTH, containerWidth || MIN_CHART_WIDTH);

  const layoutStable = useMemo(() => {
    if (!agg) return null;
    return runLayout(layoutWidth, agg);
  }, [agg, layoutWidth]);

  useEffect(() => {
    if (!chartRef.current || animatedRef.current) return;
    animatedRef.current = true;
    chartRef.current.querySelectorAll(".sankey-band").forEach((p) => p.classList.add("sankey-band-animate"));
  }, [layoutStable]);

  const clearHover = useCallback(() => {
    chartRef.current?.removeAttribute("data-hovered");
    chartRef.current?.querySelectorAll(".is-hovered").forEach((el) => el.classList.remove("is-hovered"));
    if (tooltipRef.current) tooltipRef.current.style.visibility = "hidden";
  }, []);

  const positionTooltip = useCallback((clientX: number, clientY: number, payload: HitPayload) => {
    const container = containerRef.current;
    const tip = tooltipRef.current;
    if (!container || !tip) return;
    const rect = container.getBoundingClientRect();
    let left = clientX - rect.left + 14;
    let top = clientY - rect.top + 14;
    tip.style.visibility = "visible";
    tip.querySelector("[data-tip-title]")!.textContent = payload.title;
    tip.querySelector("[data-tip-sub]")!.textContent = payload.subtitle;
    tip.querySelector("[data-tip-amt]")!.textContent = fmtRisk(payload.cents);
    tip.querySelector("[data-tip-count]")!.textContent = `${payload.count} transaction${payload.count === 1 ? "" : "s"}`;
    const hintEl = tip.querySelector("[data-tip-hint]") as HTMLElement;
    if (payload.hint) {
      hintEl.textContent = payload.hint;
      hintEl.style.display = "block";
    } else hintEl.style.display = "none";
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    if (left + tipW > rect.width - 8) left = clientX - rect.left - tipW - 14;
    if (top + tipH > rect.height - 8) top = clientY - rect.top - tipH - 14;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, []);

  const setHoverTarget = useCallback(
    (hitId: string | null, payload: HitPayload | null, clientX?: number, clientY?: number) => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      const svg = chartRef.current;
      if (!svg) return;
      svg.querySelectorAll(".is-hovered").forEach((el) => el.classList.remove("is-hovered"));
      if (!hitId || !payload) {
        hideTimer.current = setTimeout(clearHover, 100);
        return;
      }
      svg.setAttribute("data-hovered", hitId);
      svg.querySelector(`[data-sankey-hit="${hitId}"]`)?.classList.add("is-hovered");
      if (clientX != null && clientY != null) positionTooltip(clientX, clientY, payload);
    },
    [clearHover, positionTooltip],
  );

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const t = e.target as Element;
      const hit = t.closest("[data-sankey-hit]") as HTMLElement | null;
      if (!hit) {
        if (!hideTimer.current) hideTimer.current = setTimeout(clearHover, 100);
        return;
      }
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      const payload: HitPayload = {
        title: hit.dataset.tipTitle ?? "",
        subtitle: hit.dataset.tipSub ?? "",
        cents: Number(hit.dataset.tipCents ?? 0),
        count: Number(hit.dataset.tipCount ?? 0),
        hint: hit.dataset.tipHint,
      };
      setHoverTarget(hit.dataset.sankeyHit ?? null, payload, e.clientX, e.clientY);
    },
    [clearHover, setHoverTarget],
  );

  const handleChartMouseLeave = useCallback(() => {
    hideTimer.current = setTimeout(clearHover, 100);
  }, [clearHover]);

  if (!agg) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-[8px] border border-rule bg-sheet text-[15px] text-ink-2">
        No outflows to chart yet.
      </div>
    );
  }

  const useFallback = containerWidth > 0 && containerWidth < MIN_CHART_WIDTH;
  const L = layoutStable!;

  return (
    <div ref={containerRef} className="relative rounded-[8px] border border-rule bg-sheet p-4">
      <h3 className="font-display text-[17px] font-semibold text-ink">Where the money went</h3>
      <div className="mt-3 grid text-[12px] font-medium text-ink-2" style={{ gridTemplateColumns: `${LEFT_LANE}px 1fr ${RIGHT_LANE}px` }}>
        <span>Spent from the bank</span>
        <span className="text-center">Charged to</span>
        <span className="text-right">Status</span>
      </div>
      <p className="sr-only">{agg.srSummary}</p>
      {useFallback ? (
        <SankeyFallbackBars agg={agg} onNavigate={onNavigate} />
      ) : (
        <div className="min-w-[720px]">
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-20 max-w-[240px] rounded-[8px] border border-rule bg-sheet p-3 text-[13px] shadow-[0_4px_24px_rgba(14,27,44,0.12)]"
        style={{ visibility: "hidden", left: 0, top: 0 }}
        aria-hidden
      >
        <p className="font-semibold text-ink" data-tip-title />
        <p className="text-ink-2" data-tip-sub />
        <p className="tabular mt-1 font-medium text-ink" data-tip-amt />
        <p className="text-ink-2" data-tip-count />
        <p className="mt-2 text-ink-2" data-tip-hint />
      </div>
      <svg
        ref={chartRef}
        viewBox={`0 0 ${L.width} ${L.height}`}
        width="100%"
        height={L.height}
        className="sankey-chart mt-1 block"
        role="img"
        aria-label={agg.srSummary}
        onMouseMove={handleChartMouseMove}
        onMouseLeave={handleChartMouseLeave}
      >
        {L.links.map((link) => {
          const target = link.target as LayoutNode;
          const source = link.source as LayoutNode;
          const color = target.outcome ? OUTCOME_COLOR[target.outcome] : "var(--navy-2)";
          const outcome = target.outcome ?? link.outcome;
          const tipTitle = target.title;
          const tipSub = target.subtitle;
          return (
            <path
              key={link.id}
              d={sankeyLinkHorizontal()(link) ?? ""}
              fill="none"
              stroke={color}
              strokeWidth={Math.max(MIN_NODE_HIT, link.width ?? 1)}
              className="sankey-band cursor-pointer"
              data-sankey-hit={link.id}
              data-tip-title={tipTitle}
              data-tip-sub={tipSub}
              data-tip-cents={String(link.value ?? 0)}
              data-tip-count={String(link.count)}
              data-tip-hint={target.outcome ? OUTCOME_HINT[target.outcome] : undefined}
              onClick={() => {
                if (source.kind === "bank" && target.kind === "fund") {
                  onNavigateRef.current({ kind: "fund", grantId: target.grantKey });
                } else if (target.kind === "status") {
                  onNavigateRef.current({ kind: "status", outcome, grantId: link.grantKey });
                }
              }}
            />
          );
        })}

        {L.nodes.map((node) => {
          if (node.kind === "fund") {
            const w = FUND_BLOCK_W;
            const h = Math.max(MIN_NODE_HIT, (node.y1 ?? 0) - (node.y0 ?? 0));
            const x = node.x0 ?? 0;
            const y = (node.y0 ?? 0) + ((node.y1 ?? 0) - (node.y0 ?? 0) - h) / 2;
            const labelInside = h >= 40;
            return (
              <g key={node.id}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={Math.max(h, MIN_NODE_HIT)}
                  rx={6}
                  fill="var(--navy-2)"
                  className="sankey-node cursor-pointer"
                  data-sankey-hit={node.id}
                  data-tip-title={node.title}
                  data-tip-sub={node.subtitle}
                  data-tip-cents={String(node.cents)}
                  data-tip-count={String(node.count)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.title}, ${fmtRisk(node.cents)}`}
                  onClick={() => onNavigateRef.current({ kind: "fund", grantId: node.grantKey })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigateRef.current({ kind: "fund", grantId: node.grantKey });
                    }
                  }}
                />
                {labelInside ? (
                  <>
                    <text x={x + 10} y={y + 22} className="pointer-events-none fill-white font-semibold" style={{ fontSize: 14 }}>
                      {truncate(node.title, 18)}
                    </text>
                    <text x={x + 10} y={y + 38} className="pointer-events-none fill-white/90 tabular" style={{ fontSize: 13 }}>
                      {fmtRisk(node.cents)}
                    </text>
                  </>
                ) : (
                  <>
                    <text
                      x={x + w / 2}
                      y={y - 10}
                      textAnchor="middle"
                      className="pointer-events-none fill-ink font-semibold"
                      style={{ fontSize: 14 }}
                    >
                      {truncate(node.title, 22)}
                    </text>
                    <text
                      x={x + w / 2}
                      y={y + 6}
                      textAnchor="middle"
                      className="pointer-events-none fill-ink-2 tabular"
                      style={{ fontSize: 13 }}
                    >
                      {fmtRisk(node.cents)}
                    </text>
                  </>
                )}
              </g>
            );
          }

          const w = (node.x1 ?? 0) - (node.x0 ?? 0);
          const rawH = (node.y1 ?? 0) - (node.y0 ?? 0);
          const h = Math.max(MIN_NODE_HIT, rawH);
          const y = (node.y0 ?? 0) + (rawH - h) / 2;
          const fill =
            node.outcome != null
              ? OUTCOME_COLOR[node.outcome]
              : node.kind === "bank"
                ? "var(--navy)"
                : "var(--navy-2)";

          return (
            <rect
              key={node.id}
              x={node.x0 ?? 0}
              y={y}
              width={w}
              height={h}
              fill={fill}
              rx={2}
              className="sankey-node cursor-pointer"
              data-sankey-hit={node.id}
              data-tip-title={node.title}
              data-tip-sub={node.subtitle}
              data-tip-cents={String(node.cents)}
              data-tip-count={String(node.count)}
              data-tip-hint={node.outcome ? OUTCOME_HINT[node.outcome] : undefined}
              role={node.kind === "status" ? "button" : undefined}
              tabIndex={node.kind === "status" ? 0 : undefined}
              onClick={
                node.kind === "status" && node.outcome
                  ? () => onNavigateRef.current({ kind: "status", outcome: node.outcome!, grantId: null })
                  : undefined
              }
              onKeyDown={
                node.kind === "status"
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (node.outcome) onNavigateRef.current({ kind: "status", outcome: node.outcome, grantId: null });
                      }
                    }
                  : undefined
              }
            />
          );
        })}

        {[...L.leftLabels, ...L.rightLabels].map((lab) => (
          <g key={`lab-${lab.id}`}>
            {lab.leader && (
              <line
                x1={lab.anchor === "end" ? lab.x : lab.nodeCx}
                y1={lab.y + LABEL_BLOCK_H / 2}
                x2={lab.anchor === "end" ? lab.nodeCx : lab.x}
                y2={lab.nodeCy}
                stroke="var(--rule)"
                strokeWidth={1}
              />
            )}
            <g
              role="button"
              tabIndex={0}
              className="sankey-lane-label cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky"
              data-sankey-hit={`label-${lab.id}`}
              data-tip-title={lab.title}
              data-tip-sub={lab.subtitle}
              data-tip-cents={String(lab.cents)}
              data-tip-count={String(lab.count)}
              data-tip-hint={lab.outcome ? OUTCOME_HINT[lab.outcome] : undefined}
              onClick={() => navigateFromLabel(lab, onNavigateRef.current)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigateFromLabel(lab, onNavigateRef.current);
                }
              }}
            >
              <rect
                x={lab.anchor === "end" ? lab.x - 158 : lab.x}
                y={lab.y}
                width={158}
                height={LABEL_BLOCK_H}
                fill="transparent"
              />
              <text
                x={lab.x}
                y={lab.y + 14}
                textAnchor={lab.anchor}
                className="fill-ink font-semibold"
                style={{ fontSize: 14 }}
              >
                {lab.title}
              </text>
              <text
                x={lab.x}
                y={lab.y + 30}
                textAnchor={lab.anchor}
                className="fill-ink-2 tabular"
                style={{ fontSize: 13 }}
              >
                {lab.amount}
              </text>
            </g>
          </g>
        ))}
      </svg>
        </div>
      )}
      <p className="mt-3 max-w-[65ch] text-[14px] text-ink-2">{agg.caption}</p>
    </div>
  );
}

function navigateFromLabel(lab: LaneLabel, onNavigate: (n: SankeyNavigate) => void) {
  if (lab.kind === "fund") onNavigate({ kind: "fund", grantId: lab.grantKey });
  else if (lab.kind === "status" && lab.outcome) onNavigate({ kind: "status", outcome: lab.outcome, grantId: null });
  else if (lab.kind === "bank") onNavigate({ kind: "fund", grantId: null });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function SankeyFallbackBars({
  agg,
  onNavigate,
}: {
  agg: NonNullable<ReturnType<typeof buildSankeyAggregates>>;
  onNavigate: (n: SankeyNavigate) => void;
}) {
  return (
      <div className="mt-4 space-y-4">
        {agg.fundBreakdown.map((f) => {
          const total = f.total || 1;
          const segs = (
            [
              { key: "clean" as Outcome, cents: f.clean, color: OUTCOME_COLOR.clean, label: "Clean" },
              { key: "needs_you" as Outcome, cents: f.needs_you, color: OUTCOME_COLOR.needs_you, label: "Needs review" },
              { key: "disallowed" as Outcome, cents: f.disallowed, color: OUTCOME_COLOR.disallowed, label: "Disallowed" },
            ] as const
          ).filter((s) => s.cents > 0);
          return (
            <div key={f.grantKey}>
              <p className="text-[14px] font-semibold text-ink">{f.title}</p>
              <div className="mt-1 flex h-8 w-full overflow-hidden rounded-[6px]">
                {segs.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="h-full min-w-[4px] cursor-pointer transition-opacity hover:opacity-90"
                    style={{ width: `${(s.cents / total) * 100}%`, backgroundColor: s.color }}
                    aria-label={`${s.label} ${fmtRisk(s.cents)}`}
                    onClick={() =>
                      onNavigate(
                        s.key === "clean"
                          ? { kind: "fund", grantId: f.grantId }
                          : { kind: "status", outcome: s.key, grantId: f.grantId },
                      )
                    }
                  />
                ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-ink-2">
                {segs.map((s) => (
                  <span key={s.key}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label} {fmtRisk(s.cents)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
  );
}
