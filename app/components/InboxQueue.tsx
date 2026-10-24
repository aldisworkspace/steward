"use client";

import { filterLabel, matchesInboxFilter, type InboxFilter } from "@/lib/inboxFilters";
import { queueIconForRule } from "@/lib/queueIcon";
import { fmtTableAmount } from "../format";

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
}: {
  rows: {
    txnId: string;
    status: string;
    amountCents: number;
    description: string;
    reason: string;
    ruleId?: string | null;
    hasPrecedent?: boolean;
    resolved?: boolean;
  }[];
  selected: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  setFilter: (f: InboxFilter) => void;
}) {
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
        {filtered.map((r) => {
          const Icon = queueIconForRule(r.ruleId);
          return (
            <button
              key={r.txnId}
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
                <span className="truncate text-[15px] font-medium">{r.description}</span>
                <span className="line-clamp-1 text-[13px] text-ink-2">
                  {r.reason}
                  {r.hasPrecedent ? " Ⓟ" : ""}
                </span>
              </span>
              <span className="tabular flex shrink-0 items-center pr-3 text-[15px] font-bold">
                {fmtTableAmount(r.amountCents)}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
