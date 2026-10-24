"use client";

import { filterLabel, matchesInboxFilter, type InboxFilter } from "@/lib/inboxFilters";
import { groupInboxRows, type QueueRow } from "@/lib/inboxGroups";
import { queueIconForRule } from "@/lib/queueIcon";
import { fmtRisk, fmtTableAmount } from "../format";
import { useState } from "react";

const FILTERS: InboxFilter[] = [
  "all",
  "disallowed",
  "prior_approval",
  "bookkeeper",
  "duplicates",
  "resolved",
];

export function InboxQueue({
  rows,
  selected,
  onSelect,
  filter,
  setFilter,
  onApproveAll,
}: {
  rows: QueueRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  setFilter: (f: InboxFilter) => void;
  onApproveAll?: (txnIds: string[]) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const filtered = rows.filter((r) => matchesInboxFilter(r.ruleId, r.status, filter, r.resolved));
  const counts = Object.fromEntries(
    FILTERS.map((f) => [
      f,
      f === "resolved"
        ? rows.filter((r) => r.resolved).length
        : rows.filter((r) => matchesInboxFilter(r.ruleId, r.status, f, r.resolved)).length,
    ]),
  ) as Record<InboxFilter, number>;

  return (
    <aside className="flex h-full flex-col border-r border-rule bg-paper">
      <div className="flex flex-wrap gap-2 border-b border-rule p-3">
        {FILTERS.map((f) => {
          const chipColor =
            f === "disallowed"
              ? "border-redpen/40 bg-redpen-tint text-redpen"
              : f === "prior_approval"
                ? "border-attention/50 bg-attention-tint text-ink"
                : f === "bookkeeper"
                  ? "border-sky/40 bg-sky/10 text-ink"
                  : f === "duplicates"
                    ? "border-rule bg-sheet text-ink-2"
                    : "border-rule bg-sheet text-ink";
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${
                filter === f ? chipColor + " ring-2 ring-sky/40" : "border-rule text-ink-2"
              }`}
            >
              {filterLabel(f)} {counts[f]}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-4 text-[15px] text-money">Everything reconciled. Nothing needs you.</p>
        )}
        {groupInboxRows(filtered).map((g) => {
          if (g.kind === "group") {
            const open = expanded[g.key];
            return (
              <div key={g.key} className="border-b border-rule">
                <div className="flex items-center gap-2 border-l-4 border-l-attention bg-attention-tint/40 px-2 py-2">
                  <button type="button" className="flex-1 text-left text-[13px] font-medium" onClick={() => setExpanded((e) => ({ ...e, [g.key]: !open }))}>
                    {g.label} · {fmtRisk(g.atRiskCents)} at risk
                  </button>
                  {onApproveAll && (
                    <button
                      type="button"
                      className="shrink-0 rounded-[6px] bg-money px-2 py-1 text-[12px] font-medium text-white"
                      onClick={() => onApproveAll(g.rows.map((r) => r.txnId))}
                    >
                      Approve all {g.rows.length}
                    </button>
                  )}
                </div>
                {open &&
                  g.rows.map((r) => (
                    <QueueRowButton key={r.txnId} r={r} selected={selected} onSelect={onSelect} />
                  ))}
              </div>
            );
          }
          return <QueueRowButton key={g.row.txnId} r={g.row} selected={selected} onSelect={onSelect} />;
        })}
      </div>
    </aside>
  );
}

function QueueRowButton({
  r,
  selected,
  onSelect,
}: {
  r: QueueRow;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const Icon = queueIconForRule(r.ruleId);
  return (
    <button
      type="button"
      onClick={() => onSelect(r.txnId)}
      className={`flex h-16 w-full items-stretch border-l-4 text-left ${
        r.status === "blocked" ? "border-l-redpen" : "border-l-attention"
      } ${selected === r.txnId ? "bg-sheet" : "hover:bg-sheet/80"}`}
    >
      <span className="flex w-10 shrink-0 items-center justify-center text-ink-2">
        <Icon size={18} strokeWidth={2} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center pr-3">
        <span className="truncate text-[14px] font-medium">{r.description}</span>
        <span className="line-clamp-1 text-[13px] text-ink-2">{r.reason}</span>
      </span>
      <span className="tabular flex shrink-0 items-center pr-3 text-[14px] font-bold">
        {fmtTableAmount(r.amountCents)}
      </span>
    </button>
  );
}
