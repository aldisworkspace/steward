"use client";

import type { BreakdownSegment, FundBreakdownResult, FundBreakdownRow } from "@/lib/fundBreakdown";
import { fmtRisk } from "../format";

export type FundBreakdownNavigate = {
  grantId: string | null;
  segment: BreakdownSegment | "all_open";
};

function fmtWhole(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

function summaryLine(row: FundBreakdownRow): { text: string; money?: boolean } {
  const parts: string[] = [];
  if (row.needsYouCents > 0) parts.push(`${fmtWhole(row.needsYouCents)} needs you`);
  if (row.notAllowedCents > 0) {
    if (row.grantId === null) {
      parts.push(`${fmtWhole(row.notAllowedCents)} moved here because a grant doesn't allow it`);
    } else {
      parts.push(`${fmtWhole(row.notAllowedCents)} not allowed`);
    }
  }
  if (parts.length === 0) return { text: "All clean", money: true };
  return { text: parts.join(" · ") };
}

const SEGMENT_STYLE: Record<
  BreakdownSegment,
  { bg: string; hover: string; label: string }
> = {
  clean: {
    bg: "bg-money/85",
    hover: "hover:brightness-95",
    label: "clean",
  },
  needs_you: {
    bg: "bg-attention",
    hover: "hover:brightness-95",
    label: "need you",
  },
  not_allowed: {
    bg: "bg-redpen",
    hover: "hover:brightness-95",
    label: "not allowed",
  },
};

function SegmentBar({
  row,
  onNavigate,
}: {
  row: FundBreakdownRow;
  onNavigate: (nav: FundBreakdownNavigate) => void;
}) {
  const total = row.totalOutflowCents;
  const segments = (
    [
      { key: "clean" as const, cents: row.cleanCents, count: row.segmentCounts.clean },
      { key: "needs_you" as const, cents: row.needsYouCents, count: row.segmentCounts.needs_you },
      { key: "not_allowed" as const, cents: row.notAllowedCents, count: row.segmentCounts.not_allowed },
    ] as const
  ).filter((s) => s.cents > 0);

  if (total <= 0) {
    return <div className="h-[10px] w-full rounded-[3px] bg-rule" aria-hidden />;
  }

  return (
    <div
      className="flex h-[10px] w-full gap-0.5 overflow-hidden rounded-[3px]"
      role="group"
      aria-label={`${row.title} spending breakdown`}
    >
      {segments.map((s) => {
        const style = SEGMENT_STYLE[s.key];
        const pctLabel = `${fmtWhole(s.cents)} · ${s.count} item${s.count === 1 ? "" : "s"} ${style.label}`;
        return (
          <button
            key={s.key}
            type="button"
            style={{ flex: s.cents, minWidth: s.cents > 0 ? 4 : 0 }}
            className={`group/seg relative h-full ${style.bg} ${style.hover} fund-bar-grow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky`}
            aria-label={`${row.title}: ${pctLabel}. Open in inbox.`}
            onClick={() =>
              onNavigate({
                grantId: row.grantId,
                segment: s.key === "clean" ? "clean" : s.key,
              })
            }
          >
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-rule bg-sheet px-2 py-1 text-[12px] text-ink opacity-0 shadow-[var(--shadow-panel)] transition-opacity duration-150 group-hover/seg:opacity-100 group-focus-visible/seg:opacity-100">
              {pctLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FundBreakdown({
  data,
  onNavigate,
}: {
  data: FundBreakdownResult | null | undefined;
  onNavigate: (nav: FundBreakdownNavigate) => void;
}) {
  if (!data) {
    return (
      <div className="rounded-[8px] border border-rule bg-sheet p-6 text-[14px] text-ink-2">
        No outflows to show yet.
      </div>
    );
  }

  const { funds, totals, srSummary } = data;

  return (
    <section
      className="rounded-[8px] border border-rule bg-sheet p-6"
      aria-labelledby="fund-breakdown-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 id="fund-breakdown-title" className="text-[17px] font-semibold text-ink">
          Spending by fund
        </h2>
        <p className="text-[13px] text-ink-2" aria-hidden>
          <span className="inline-flex items-center gap-3">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-money/85" aria-hidden />
              Clean {fmtWhole(totals.cleanCents)}
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-attention" aria-hidden />
              Needs you {fmtWhole(totals.needsYouCents)}
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-redpen" aria-hidden />
              Not allowed {fmtWhole(totals.notAllowedCents)}
            </span>
          </span>
        </p>
      </div>

      <p className="sr-only">{srSummary}</p>

      <ul className="mt-6 list-none space-y-4">
        {funds.map((row, i) => {
          const summary = summaryLine(row);
          return (
            <li
              key={row.grantKey}
              className={i > 0 ? "border-t border-rule pt-4" : undefined}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink">{row.title}</p>
                <p className="shrink-0 tabular text-[14px] font-semibold text-ink">
                  {fmtWhole(row.totalOutflowCents)}
                </p>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-2">{row.subtitle}</p>
              <div className="mt-3">
                <SegmentBar row={row} onNavigate={onNavigate} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className={summary.money ? "text-money" : "text-ink-2"}>{summary.text}</span>
                {row.openCount > 0 && (
                  <button
                    type="button"
                    className="shrink-0 text-[13px] font-medium text-[#2563EB] underline-offset-2 hover:underline"
                    onClick={() => onNavigate({ grantId: row.grantId, segment: "all_open" })}
                  >
                    {row.openCount} items →
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
