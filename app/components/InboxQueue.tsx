"use client";

import {
  filterLabel,
  matchesInboxFilter,
  MORE_FILTERS,
  PRIMARY_FILTERS,
  type InboxFilter,
} from "@/lib/inboxFilters";
import { groupInboxRows, type QueueRow } from "@/lib/inboxGroups";
import { getFundLabel } from "@/lib/fundLabels";
import { QueueRuleIcon } from "@/lib/queueIcon";
import type { GrantTerms } from "@/lib/types";
import { displayVendor } from "@/lib/displayVendor";
import { queueLine2 } from "@/lib/queueLine2";
import { fmtRisk, fmtTableAmount } from "../format";
import { CountUp } from "./CountUp";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function InboxQueue({
  rows,
  grants,
  fundFilter,
  onClearFund,
  selected,
  onSelect,
  filter,
  setFilter,
  onApproveAll,
  approveAllBusy,
  atRiskCents,
  openCount,
  doneCount,
}: {
  rows: QueueRow[];
  grants: GrantTerms[];
  fundFilter: string | null;
  onClearFund: () => void;
  selected: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  setFilter: (f: InboxFilter) => void;
  onApproveAll?: (txnIds: string[]) => void;
  approveAllBusy?: boolean;
  atRiskCents: number;
  openCount: number;
  doneCount: number;
}) {
  const fundBanner =
    fundFilter != null ? getFundLabel(fundFilter === "general" ? null : fundFilter, grants) : null;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    function onDoc(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  const openRows = rows.filter((r) => !r.resolved);
  const filtered = rows.filter((r) => matchesInboxFilter(r.ruleId, r.status, filter, r.resolved));

  const counts = useMemo(() => {
    const allFilters: InboxFilter[] = [...PRIMARY_FILTERS, ...MORE_FILTERS];
    return Object.fromEntries(
      allFilters.map((f) => [
        f,
        f === "done"
          ? doneCount
          : openRows.filter((r) => matchesInboxFilter(r.ruleId, r.status, f, false)).length,
      ]),
    ) as Record<InboxFilter, number>;
  }, [openRows, doneCount]);

  const emptyMessage =
    filter === "all" && openCount === 0
      ? "All clear. Nothing needs you."
      : filter === "done"
        ? doneCount === 0
          ? "Nothing decided yet."
          : ""
        : `Nothing in ${filterLabel(filter)} right now.`;

  return (
    <aside className="flex h-full flex-col border-r border-rule bg-paper" role="listbox" aria-label="Inbox queue">
      <div className="border-b border-rule px-3 py-3">
        <p className="text-[14px] font-semibold text-ink">
          {openCount} items · $
          <CountUp value={Math.round(atRiskCents / 100)} durationMs={300} /> a funder could ask you to repay
        </p>
      </div>
      {fundBanner && (
        <div className="flex items-center gap-2 border-b border-rule px-3 py-2 text-[13px]">
          <span className="text-ink-2">Fund:</span>
          <span className="font-medium">{fundBanner.title}</span>
          <button type="button" className="text-[#2563EB]" onClick={onClearFund}>
            Clear
          </button>
        </div>
      )}
      <div
        className="relative flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-visible border-b border-rule px-3 py-2"
        role="tablist"
      >
        {PRIMARY_FILTERS.map((f) => (
          <FilterChip key={f} f={f} count={counts[f]} active={filter === f} onSelect={() => setFilter(f)} />
        ))}
        <div className="relative shrink-0" ref={moreRef}>
          <button
            type="button"
            role="tab"
            aria-expanded={moreOpen}
            aria-haspopup="listbox"
            aria-selected={MORE_FILTERS.includes(filter)}
            className={`chip-button flex shrink-0 items-center gap-1 rounded-[6px] border px-2 py-1 text-[13px] ${
              MORE_FILTERS.includes(filter)
                ? "border-ink bg-sheet font-semibold text-ink"
                : "border-rule text-ink-2"
            }`}
            onClick={() => setMoreOpen((o) => !o)}
          >
            More <ChevronDown size={14} className={moreOpen ? "rotate-180 transition-transform" : "transition-transform"} />
          </button>
          {moreOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 min-w-[180px] rounded-[8px] border border-rule bg-sheet py-1 shadow-[0_8px_24px_rgba(14,27,44,0.12)]">
              {MORE_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="chip-button block w-full px-3 py-2 text-left text-[13px] hover:bg-paper"
                  onClick={() => {
                    setFilter(f);
                    setMoreOpen(false);
                  }}
                >
                  {filterLabel(f)} <span className="tabular text-ink-2">{counts[f]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 && emptyMessage && (
          <p className="p-4 text-[14px] text-ink-2">{emptyMessage}</p>
        )}
        {(() => {
          let stagger = 0;
          return groupInboxRows(filtered).map((g) => {
          if (g.kind === "group") {
            const open = expanded[g.key];
            return (
              <div key={g.key} className="border-b border-rule">
                <div className="flex items-center gap-2 border-l-4 border-l-attention bg-attention-tint/40 px-2 py-2">
                  <button
                    type="button"
                    className="flex-1 text-left text-[13px] font-medium"
                    onClick={() => setExpanded((e) => ({ ...e, [g.key]: !open }))}
                  >
                    {g.label} · {fmtRisk(g.atRiskCents).replace(".00", "")} over-charged
                  </button>
                  {onApproveAll && (
                    <button
                      type="button"
                      disabled={approveAllBusy}
                      className="shrink-0 rounded-[6px] border border-ink-2 bg-sheet px-2 py-1 text-[12px] font-medium text-ink disabled:opacity-50"
                      onClick={() => onApproveAll(g.rows.map((r) => r.txnId))}
                    >
                      {approveAllBusy ? "Approving…" : `Approve ${g.rows.length} corrections`}
                    </button>
                  )}
                </div>
                {open &&
                  g.rows.map((r) => {
                    const si = stagger++;
                    return (
                    <QueueRowButton
                      key={r.txnId}
                      r={r}
                      grants={grants}
                      selected={selected}
                      onSelect={onSelect}
                      staggerIndex={si}
                    />
                    );
                  })}
              </div>
            );
          }
          const si = stagger++;
          return (
            <QueueRowButton
              key={g.row.txnId}
              r={g.row}
              grants={grants}
              selected={selected}
              onSelect={onSelect}
              staggerIndex={si}
            />
          );
        });
        })()}
      </div>
    </aside>
  );
}

function FilterChip({
  f,
  count,
  active,
  onSelect,
}: {
  f: InboxFilter;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const dim = count === 0 && f !== "all";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`chip-button shrink-0 rounded-[6px] border px-2 py-1 text-[13px] tabular ${
        active ? "border-ink bg-sheet font-semibold text-ink" : "border-rule text-ink-2"
      } ${dim ? "opacity-60" : ""}`}
    >
      {filterLabel(f)} {count}
    </button>
  );
}

function QueueRowButton({
  r,
  grants,
  selected,
  onSelect,
  staggerIndex,
}: {
  r: QueueRow;
  grants: GrantTerms[];
  selected: string | null;
  onSelect: (id: string) => void;
  staggerIndex?: number;
}) {
  const fund = r.grantId != null ? getFundLabel(r.grantId, grants) : null;
  const statusWord = r.status === "blocked" ? "Not allowed" : "Needs you";
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected === r.txnId}
      aria-current={selected === r.txnId ? "true" : undefined}
      onClick={() => onSelect(r.txnId)}
      style={staggerIndex != null ? { animationDelay: `${staggerIndex * 40}ms` } : undefined}
      className={`inbox-row-enter flex min-h-16 w-full items-stretch border-b border-rule border-l-4 text-left hover:bg-sheet/60 ${
        r.status === "blocked" ? "border-l-redpen" : "border-l-attention"
      } ${selected === r.txnId ? "bg-sheet font-semibold" : ""}`}
    >
      <span className="flex w-10 shrink-0 items-center justify-center text-ink-2">
        <QueueRuleIcon ruleId={r.ruleId} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center pr-3">
        <span className="truncate text-[14px]" title={r.description}>
          {displayVendor(r.description)}
        </span>
        <span className="line-clamp-1 text-[13px] text-ink-2">
          {queueLine2(r.ruleId) || r.reason}
          {fund && <span> · {fund.title}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end justify-center pr-3">
        <span className="tabular text-[14px] font-semibold">{fmtTableAmount(r.amountCents)}</span>
        <span className="text-[12px] text-ink-2">{statusWord}</span>
      </span>
    </button>
  );
}
