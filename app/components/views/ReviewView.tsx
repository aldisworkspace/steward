"use client";

import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { issueLabel } from "@/lib/issueLabel";
import { matchesFundFilter } from "@/lib/fundFilter";
import { getFundLabel } from "@/lib/fundLabels";
import { shouldIgnoreAppShortcut } from "@/lib/keyboardGuard";
import type { GrantTerms } from "@/lib/types";
import { parsePackageKey, type AppUrl } from "../../hooks/useAppUrlState";
import { FIX_TYPES, fixTypeLabel, fixTypeOf, type FixType, type ReviewFilter } from "../../lib/fixType";
import { periodLabel } from "../../lib/packageText";
import { CaseFile, vendorName } from "../CaseFile";
import { Button } from "../ui/Button";
import { fmtUsd } from "../ui/Money";

type Row = {
  txnId: string;
  status: string;
  ruleId: string | null;
  grantId: string | null;
  amountCents: number;
  description: string;
  reason: string;
  resolved?: boolean;
};

function reasonFor(r: Row) {
  const label = issueLabel(r.ruleId, r.status);
  return label === "Needs your review" && r.reason && r.reason !== "Steward's judgment" ? r.reason : label;
}

export function ReviewView({
  url,
  grantTerms,
  cmdOpen,
  helpOpen,
  panelOpen,
  onWhy,
  onHelp,
}: {
  url: AppUrl;
  grantTerms: GrantTerms[];
  cmdOpen: boolean;
  helpOpen: boolean;
  panelOpen: boolean;
  onWhy: (txnId: string) => void;
  onHelp: () => void;
}) {
  const { reviewFilter: filter, caseId, fundFilter, packageId } = url;
  const queue = useQuery(api.ui.inboxQueue) as Row[] | undefined;
  const done = useQuery(api.ui.inboxResolved, filter === "done" ? {} : "skip") as Row[] | undefined;
  const caseData = useQuery(api.ui.caseFile, caseId ? { txnId: caseId } : "skip");
  const fromPkg = parsePackageKey(packageId);
  const pkgList = useQuery(api.packages.list, fromPkg ? {} : "skip");
  const fromSummary = fromPkg ? pkgList?.find((p) => p.grantId === fromPkg.grantId && p.periodStart === fromPkg.periodStart) : undefined;

  // Lines resolved in this session leave the list at once; the server catches up a moment later.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const open = useMemo(
    () => (queue ?? []).filter((r) => !hidden.has(r.txnId) && matchesFundFilter(r.grantId, fundFilter)),
    [queue, hidden, fundFilter],
  );
  const counts = useMemo(() => {
    const c = new Map<FixType, number>();
    for (const r of open) c.set(fixTypeOf(r.ruleId, r.status), (c.get(fixTypeOf(r.ruleId, r.status)) ?? 0) + 1);
    return c;
  }, [open]);

  const visible: Row[] = useMemo(() => {
    if (filter === "done") return (done ?? []).map((r) => ({ ...r, resolved: true }));
    if (filter === "all") return open;
    return open.filter((r) => fixTypeOf(r.ruleId, r.status) === filter);
  }, [filter, open, done]);

  const groups = useMemo(() => {
    if (filter === "done") return [{ id: "done" as const, label: "Decided", rows: visible }];
    return FIX_TYPES.map((f) => ({ id: f.id, label: f.label, rows: visible.filter((r) => fixTypeOf(r.ruleId, r.status) === f.id) })).filter(
      (g) => g.rows.length > 0,
    );
  }, [visible, filter]);
  const orderedIds = useMemo(() => groups.flatMap((g) => g.rows.map((r) => r.txnId)), [groups]);

  // Desktop: always show a case. Mobile: the list first; a case opens full-screen.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (!wide || caseId || filter === "done") return;
    if (orderedIds[0]) url.setCaseId(orderedIds[0]);
  }, [wide, caseId, orderedIds, filter, url]);
  // A deep link can name an open case outside the current filter/fund: show one that matches instead.
  useEffect(() => {
    if (!queue || !caseId || filter === "done" || hidden.has(caseId)) return;
    const isOpen = queue.some((r) => r.txnId === caseId);
    if (isOpen && !orderedIds.includes(caseId)) url.setCaseId(wide ? orderedIds[0] ?? null : null);
  }, [queue, caseId, filter, hidden, orderedIds, wide, url]);

  const select = useCallback((txnId: string | null) => url.setCaseId(txnId), [url]);

  const onResolved = useCallback(
    (txnId: string) => {
      setHidden((h) => new Set(h).add(txnId));
      const idx = orderedIds.indexOf(txnId);
      const next = orderedIds.filter((id) => id !== txnId)[Math.max(0, idx)] ?? null;
      if (wide) select(next);
      else select(null);
    },
    [orderedIds, select, wide],
  );
  const onRestored = useCallback(
    (txnId: string) => {
      setHidden((h) => {
        const n = new Set(h);
        n.delete(txnId);
        return n;
      });
      select(txnId);
    },
    [select],
  );

  // J / K move through the queue; ? opens shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (shouldIgnoreAppShortcut(e, { cmdOpen, helpOpen, panelOpen })) return;
      if (e.key === "?") {
        e.preventDefault();
        onHelp();
        return;
      }
      if (!orderedIds.length) return;
      const idx = caseId ? orderedIds.indexOf(caseId) : -1;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        select(orderedIds[Math.min(idx + 1, orderedIds.length - 1)] ?? null);
      } else if (k === "k") {
        e.preventDefault();
        select(orderedIds[Math.max(idx - 1, 0)] ?? null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderedIds, caseId, select, cmdOpen, helpOpen, panelOpen, onHelp]);

  // Keep the selected row in view as J/K move.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!caseId) return;
    listRef.current?.querySelector(`[data-txn="${caseId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [caseId]);

  const totalOpen = open.length;
  const fund = fundFilter ? getFundLabel(fundFilter === "general" ? null : fundFilter, grantTerms) : null;
  const showCaseMobile = !wide && !!caseId;
  const selectedResolved = filter === "done" || (!!caseId && !queue?.some((r) => r.txnId === caseId));

  const listPane = (
    <div className={`${showCaseMobile ? "hidden" : "flex"} min-h-0 min-w-0 flex-col lg:flex`}>
      {fromSummary && (
        <button
          type="button"
          onClick={() => url.openPackage(packageId!)}
          className="mb-3 min-h-11 self-start text-left text-sm text-ink-2 hover:text-ink lg:min-h-0"
        >
          ← Back to {periodLabel(fromSummary.periodStart, fromSummary.periodEnd)} package
        </button>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-serif text-xl text-ink">
          {queue === undefined ? (
            "Review"
          ) : totalOpen === 0 ? (
            <>
              Nothing to review. <em className="italic text-ink-2">Every exception has a decision.</em>
            </>
          ) : (
            <>
              <span className="tabular">{totalOpen}</span> {totalOpen === 1 ? "exception" : "exceptions"}{" "}
              <em className="italic text-ink-2">need a decision</em>
              <span className="mt-1 block font-sans text-sm font-normal not-italic tracking-normal text-ink-2">Across every package and month.</span>
            </>
          )}
        </h1>
        <button type="button" onClick={onHelp} className="hidden text-xs text-ink-2 hover:text-ink lg:inline">
          Keys: J/K next · A primary action · O override
        </button>
      </div>
      {fund && (
        <p className="mt-2 text-sm text-ink-2">
          Only {fund.title}.{" "}
          <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => url.setReviewFilter(filter, null)}>
            Show every fund
          </button>
        </p>
      )}

      <div role="tablist" aria-label="Fix type" className="-mx-1 mt-4 flex gap-1 overflow-x-auto pb-2 lg:flex-wrap lg:overflow-visible">
        {(["all", ...FIX_TYPES.map((f) => f.id), "done"] as ReviewFilter[]).map((f) => {
          const n = f === "all" ? totalOpen : f === "done" ? null : (counts.get(f as FixType) ?? 0);
          if (n === 0 && f !== filter) return null;
          const active = filter === f;
          return (
            <button
              key={f}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => url.setReviewFilter(f)}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border px-3 text-sm sm:min-h-8 ${
                active ? "border-ink bg-ink text-sheet" : "border-rule-strong bg-sheet text-ink hover:border-ink-2"
              }`}
            >
              {fixTypeLabel(f)}
              {n != null && <span className={`tabular text-xs ${active ? "text-sheet/70" : "text-ink-2"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div ref={listRef} className="mt-2 min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
        {queue === undefined ? (
          <QueueSkeleton />
        ) : visible.length === 0 ? (
          <EmptyQueue filter={filter} totalOpen={totalOpen} onAll={() => url.setReviewFilter("all")} onPackages={() => url.setTab("packages")} />
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-label={g.label} className="mb-4">
              {filter === "all" && (
                <h2 className="sticky top-0 z-[1] flex items-baseline justify-between bg-paper py-2 text-xs font-medium text-ink-2">
                  <span>{g.label}</span>
                  <span className="tabular">{g.rows.length}</span>
                </h2>
              )}
              <ul className="overflow-hidden rounded-md border border-rule bg-sheet">
                {g.rows.map((r) => {
                  const active = r.txnId === caseId;
                  const red = r.status === "blocked";
                  return (
                    <li key={r.txnId} data-txn={r.txnId} className="border-b border-rule last:border-b-0">
                      <button
                        type="button"
                        onClick={() => select(r.txnId)}
                        aria-current={active ? "true" : undefined}
                        className={`grid min-h-14 w-full grid-cols-[1fr_auto] gap-x-4 px-4 py-3 text-left transition-colors duration-100 ${
                          active ? "bg-paper-2" : "hover:bg-paper"
                        }`}
                      >
                        <span className={`min-w-0 truncate text-base ${active ? "font-medium text-ink" : "text-ink"}`}>{vendorName(r)}</span>
                        <span className="tabular text-base text-ink">{fmtUsd(Math.abs(r.amountCents))}</span>
                        <span className={`col-span-2 mt-0.5 flex min-w-0 items-center gap-2 text-sm ${red ? "text-redpen-ink" : "text-ink-2"}`}>
                          <span
                            aria-hidden
                            className={`h-1.5 w-1.5 shrink-0 rounded-pill ${r.resolved ? "bg-ink-3" : red ? "bg-redpen" : "bg-amber"}`}
                          />
                          <span className="truncate">{r.resolved ? `${reasonFor(r)} · decided` : reasonFor(r)}</span>
                          <span className="ml-auto shrink-0 text-xs text-ink-2">{r.txnId}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:h-[calc(100dvh-8.5rem)] lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
      {listPane}
      <section
        aria-label="Case"
        className={`${showCaseMobile ? "fixed inset-0 z-40 overflow-y-auto bg-sheet panel-in" : "hidden"} lg:static lg:z-auto lg:block lg:min-h-0 lg:overflow-y-auto lg:rounded-md lg:border lg:border-rule lg:bg-sheet lg:shadow-sheet`}
      >
        {caseId ? (
          <CaseFile
            data={caseData}
            grantTerms={grantTerms}
            resolved={selectedResolved && caseData?.decision?.status !== "auto"}
            onResolved={onResolved}
            onRestored={onRestored}
            onWhy={onWhy}
            onBack={() => select(null)}
            cmdOpen={cmdOpen}
            helpOpen={helpOpen}
            panelOpen={panelOpen}
          />
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-center text-base text-ink-2">
            {totalOpen ? "Pick a line to see what Steward found." : "Nothing is waiting on you."}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyQueue({
  filter,
  totalOpen,
  onAll,
  onPackages,
}: {
  filter: ReviewFilter;
  totalOpen: number;
  onAll: () => void;
  onPackages: () => void;
}) {
  if (filter === "done") return <p className="py-10 text-center text-base text-ink-2">No decisions yet.</p>;
  if (totalOpen > 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-base text-ink-2">Nothing of this kind is open.</p>
        <Button size="sm" className="mt-3" onClick={onAll}>
          Show all {totalOpen}
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-rule bg-sheet px-6 py-10 text-center">
      <p className="text-base text-ink">Every flagged line has a decision from a person.</p>
      <p className="mt-1 text-sm text-ink-2">Check the packages: the open-exceptions check should now pass.</p>
      <Button size="sm" variant="primary" className="mt-4" onClick={onPackages}>
        Back to packages
      </Button>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="animate-pulse space-y-2" aria-busy aria-label="Loading exceptions">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 rounded-md border border-rule bg-sheet" />
      ))}
    </div>
  );
}
