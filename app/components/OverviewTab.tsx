"use client";

import type { GrantTerms } from "@/lib/types";
import { useMemo } from "react";
import { fmtRisk, fmtTableAmount } from "../format";
import { CountUp } from "./CountUp";
import { MoneyFlowSankey } from "./MoneyFlowSankey";

type Stats = {
  total: number;
  clean: number;
  needYou: number;
  resolved: number;
  atRiskCents: number;
  blocked: number;
  review: number;
};

type GrantRow = {
  terms: unknown;
  spentByLine: Record<string, number>;
  lineMeta?: Record<string, { overCents: number; overPct: number }>;
};

export function OverviewTab({
  stats,
  grants,
  ledger,
  queue,
  runStatus,
  runProgress,
  audit,
  onReviewInbox,
  onBankFeed,
  onDraftReport,
  onSankeyOutcome,
  onJournalFilter,
}: {
  stats: Stats | undefined;
  grants: GrantRow[] | undefined;
  ledger: { amountCents: number; grantId: string | null; status: string }[] | undefined;
  queue: { txnId: string; status: string; grantId: string | null }[];
  runStatus: string | undefined;
  runProgress: string | undefined;
  audit: { action: string; why: string }[] | undefined;
  onReviewInbox: () => void;
  onBankFeed: () => void;
  onDraftReport: () => void;
  onSankeyOutcome: (outcome: "clean" | "needs_you" | "disallowed") => void;
  onJournalFilter: (action: string | null) => void;
}) {
  const needYou = stats?.needYou ?? 0;
  const resolved = stats?.resolved ?? 0;
  const openTotal = needYou + resolved;
  const pct = openTotal ? Math.round((resolved / openTotal) * 100) : 100;
  const complete = needYou === 0 && openTotal > 0;

  const reportLine = useMemo(() => {
    const termsList = (grants ?? [])
      .map((g) => g.terms as GrantTerms | null)
      .filter(Boolean) as GrantTerms[];
    const withDue = termsList
      .filter((t) => t.reportDue)
      .map((t) => {
        const due = new Date(t.reportDue!);
        const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
        return { grantId: t.grantId, days };
      })
      .sort((a, b) => a.days - b.days)[0];
    if (!withDue) return null;
    return { grantId: withDue.grantId, days: withDue.days };
  }, [grants]);

  const timeline = useMemo(() => {
    const steps = [
      { id: "feed", label: "Bank feed received", action: "run_summary" },
      { id: "contracts", label: "Read grant contracts", action: "extract_grant_terms" },
      { id: "coded", label: `Coded ${stats?.clean ?? 0} clean`, action: "run_summary" },
      { id: "flagged", label: `Flagged ${(stats?.blocked ?? 0) + (stats?.review ?? 0)}`, action: "run_summary" },
      { id: "entries", label: "Proposed journal entries", action: "run_summary" },
      { id: "wait", label: "Waiting on you", action: "run_summary" },
    ];
    const running = runStatus === "running";
    let active = running ? 2 : needYou > 0 ? 5 : 4;
    if ((audit ?? []).some((a) => a.why?.includes("Bank feed"))) active = Math.max(active, 0);
    return { steps, active, running };
  }, [stats, needYou, runStatus, audit]);

  const grantCards = (grants ?? []).map((g, i) => {
    const t = g.terms as GrantTerms | null;
    if (!t) return null;
    const gid = t.grantId;
    const spent = Object.entries(g.spentByLine)
      .filter(([k]) => k.startsWith(gid))
      .reduce((a, [, v]) => a + v, 0);
    const budget = t.totalAward * 100;
    const spentPct = budget ? (spent / budget) * 100 : 0;
    const start = new Date(t.periodStart).getTime();
    const end = new Date(t.periodEnd).getTime();
    const now = Date.now();
    const elapsedPct = end > start ? ((now - start) / (end - start)) * 100 : 0;
    const burnHot = spentPct > elapsedPct + 5;
    const openForGrant = queue.filter((q) => q.grantId === gid).length;
    const topLines = [...t.budgetLines]
      .map((bl) => {
        const key = `${gid}:${bl.code}`;
        const lineSpent = g.spentByLine[key] ?? 0;
        const lineBudget = bl.amount * 100;
        return { ...bl, lineSpent, lineBudget };
      })
      .sort((a, b) => b.lineSpent - a.lineSpent)
      .slice(0, 3);
    const dueDays = t.reportDue
      ? Math.ceil((new Date(t.reportDue).getTime() - Date.now()) / 86400000)
      : null;
    const hue = gid.startsWith("GA") ? "var(--navy)" : "var(--money)";
    return (
      <article
        key={gid}
        className="rounded-[10px] border border-rule bg-sheet p-4"
        style={{ borderTopWidth: 4, borderTopColor: hue }}
      >
        <h3 className="font-display text-[17px] font-semibold">{gid}</h3>
        <p className="mt-1 text-[13px] text-ink-2">
          {t.funder} · {t.periodStart} – {t.periodEnd}
        </p>
        <div className="mt-4 flex items-center gap-4">
          <RadialGauge pct={Math.min(100, spentPct)} hot={burnHot} />
          <div className="text-[13px] text-ink-2">
            <p className={burnHot ? "text-attention font-medium" : ""}>
              {Math.round(spentPct)}% spent · {Math.round(elapsedPct)}% of period elapsed
            </p>
            {dueDays !== null && (
              <span className="mt-2 inline-block rounded-full bg-attention-tint px-2 py-0.5 text-[12px] text-ink">
                Report due {t.reportDue?.slice(5)} · {dueDays} days
              </span>
            )}
            <p className="mt-2">{openForGrant} open inbox items</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {topLines.map((bl) => {
            const cap = t.lineVarianceLimitPct
              ? bl.lineBudget * (1 + t.lineVarianceLimitPct / 100)
              : bl.lineBudget;
            const fill = bl.lineBudget ? Math.min(100, (bl.lineSpent / bl.lineBudget) * 100) : 0;
            const capPct = bl.lineBudget ? Math.min(100, (cap / bl.lineBudget) * 100) : 100;
            return (
              <div key={bl.code}>
                <div className="flex justify-between text-[12px]">
                  <span>
                    {bl.code} {bl.name}
                  </span>
                  <span className="tabular text-ink-2">{fmtTableAmount(bl.lineSpent)}</span>
                </div>
                <div className="relative mt-1 h-1.5 bg-rule">
                  <div className="h-full bg-money" style={{ width: `${fill}%` }} />
                  {t.lineVarianceLimitPct && (
                    <div className="absolute top-0 h-full w-px bg-ink-2" style={{ left: `${capPct}%` }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </article>
    );
  });

  const clawDollars = Math.round((stats?.atRiskCents ?? 0) / 100);

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8">
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="font-display text-[40px] font-semibold leading-[1.15] text-ink">
            <span className="text-redpen tabular">
              $<CountUp value={clawDollars} />
            </span>{" "}
            of grant spending could be clawed back.
          </p>
          <p className="mt-3 text-[17px] text-ink-2">
            Steward checked {stats?.total ?? 0} transactions against {(grants ?? []).length} grant
            agreements. {needYou} need you
            {reportLine
              ? ` before the ${reportLine.grantId} report is due in ${reportLine.days} days.`
              : "."}
          </p>
          <div className="mt-6">
            {complete ? (
              <div
                className="font-display inline-block border-2 border-money px-4 py-2 text-[15px] font-bold text-money"
                style={{ transform: "rotate(-2deg)" }}
              >
                Books reconciled
              </div>
            ) : (
              <>
                <p className="text-[13px] font-medium text-ink-2">
                  Resolved {resolved} of {openTotal || needYou}
                </p>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-rule">
                  <div
                    className="h-full bg-money transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onReviewInbox}
              className="rounded-[6px] bg-money px-4 py-2.5 text-[15px] font-medium text-white"
            >
              Review {needYou} items
            </button>
            <button
              type="button"
              onClick={onBankFeed}
              className="rounded-[6px] border-2 border-navy px-4 py-2.5 text-[15px] font-medium text-navy"
            >
              Bank feed arrives
            </button>
            <button
              type="button"
              onClick={onDraftReport}
              className="rounded-[6px] border border-rule px-4 py-2.5 text-[15px] font-medium text-ink"
            >
              Draft funder report
            </button>
          </div>
        </div>
        <div className="lg:col-span-7">
          <MoneyFlowSankey ledger={ledger} onOutcomeClick={onSankeyOutcome} />
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">{grantCards}</div>

      <section className="mt-10">
        <h2 className="font-display text-[17px] font-semibold text-ink">Steward&apos;s day</h2>
        <ol className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          {timeline.steps.map((step, i) => (
            <li key={step.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onJournalFilter(step.action)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                  i === timeline.active
                    ? "border-attention bg-attention-tint text-ink"
                    : "border-rule bg-sheet text-ink-2"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full bg-navy ${i === timeline.active && timeline.running ? "presence-dot-running" : ""}`}
                />
                {step.label}
              </button>
              {i < timeline.steps.length - 1 && <span className="text-ink-2">→</span>}
            </li>
          ))}
        </ol>
        {runStatus === "running" && runProgress && (
          <p className="mt-2 text-[13px] text-ink-2">{runProgress}</p>
        )}
      </section>
    </div>
  );
}

function RadialGauge({ pct, hot }: { pct: number; hot: boolean }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-label={`${Math.round(pct)} percent spent`}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--rule)" strokeWidth="8" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={hot ? "var(--attention)" : "var(--money)"}
        strokeWidth="8"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" className="fill-ink text-[13px] font-semibold">
        {Math.round(pct)}%
      </text>
    </svg>
  );
}
