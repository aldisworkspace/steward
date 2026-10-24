"use client";

import { getFundLabel } from "@/lib/fundLabels";
import type { GrantTerms } from "@/lib/types";
import { useMemo } from "react";
import { useNowMs } from "../hooks/useNowMs";
import { fmtRisk, fmtTableAmount } from "../format";
import { CountUp } from "./CountUp";
import { GlossaryTerm } from "./GlossaryTerm";
import { FundBreakdown, type FundBreakdownNavigate } from "./FundBreakdown";
import type { FundBreakdownResult } from "@/lib/fundBreakdown";

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
  fundBreakdown,
  queue,
  runStatus,
  runProgress,
  audit,
  onReviewInbox,
  onBankFeed,
  onDraftReport,
  onFundNavigate,
  onGrantInbox,
  onJournalFilter,
}: {
  stats: Stats | undefined;
  grants: GrantRow[] | undefined;
  fundBreakdown: FundBreakdownResult | null | undefined;
  queue: { txnId: string; status: string; grantId: string | null }[];
  runStatus: string | undefined;
  runProgress: string | undefined;
  audit: { action: string; why: string }[] | undefined;
  onReviewInbox: () => void;
  onBankFeed: () => void;
  onDraftReport: () => void;
  onFundNavigate: (nav: FundBreakdownNavigate) => void;
  onGrantInbox: (grantId: string) => void;
  onJournalFilter: (action: string | null) => void;
}) {
  const nowMs = useNowMs();
  const needYou = stats?.needYou ?? 0;
  const resolved = stats?.resolved ?? 0;
  const openTotal = needYou + resolved;
  const pct = openTotal ? Math.round((resolved / openTotal) * 100) : 100;
  const complete = needYou === 0 && openTotal > 0;
  const termsList = useMemo(
    () => (grants ?? []).map((g) => g.terms as GrantTerms | null).filter(Boolean) as GrantTerms[],
    [grants],
  );

  const reportLine = useMemo(() => {
    const withDue = termsList
      .filter((t) => t.reportDue)
      .map((t) => {
        const due = new Date(t.reportDue! + "T12:00:00");
        const days = Math.ceil((due.getTime() - nowMs) / 86400000);
        const dueLabel = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return { grantId: t.grantId, days, title: getFundLabel(t.grantId, termsList).title, dueLabel };
      })
      .filter((x) => x.days <= 21 && x.days >= 0)
      .sort((a, b) => a.days - b.days)[0];
    if (!withDue) return null;
    return withDue;
  }, [termsList, nowMs]);

  const deadlineHeadline = useMemo(() => {
    if (!reportLine) return null;
    const inDays =
      reportLine.days === 0
        ? "today"
        : reportLine.days === 1
          ? "in 1 day"
          : `in ${reportLine.days} days`;
    const items = needYou;
    return `${reportLine.title} report due ${reportLine.dueLabel} · ${inDays} · ${items} item${items === 1 ? "" : "s"} still need you`;
  }, [reportLine, needYou]);

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
    const fund = getFundLabel(gid, termsList);
    const spent = Object.entries(g.spentByLine)
      .filter(([k]) => k.startsWith(gid))
      .reduce((a, [, v]) => a + v, 0);
    const budget = t.totalAward * 100;
    const spentPct = budget ? (spent / budget) * 100 : 0;
    const start = new Date(t.periodStart).getTime();
    const end = new Date(t.periodEnd).getTime();
    const elapsedPct = end > start && nowMs > 0 ? ((nowMs - start) / (end - start)) * 100 : 0;
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
      ? Math.ceil((new Date(t.reportDue).getTime() - nowMs) / 86400000)
      : null;
    const hue = gid.startsWith("GA") ? "var(--navy)" : "var(--money)";
    return (
      <article
        key={gid}
        role="button"
        tabIndex={0}
        onClick={() => onGrantInbox(gid)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onGrantInbox(gid);
          }
        }}
        className="cursor-pointer rounded-[8px] border border-rule bg-sheet p-4 transition-colors hover:border-sky/50"
        style={{ borderTopWidth: 4, borderTopColor: hue }}
      >
        <h3 className="font-display text-[17px] font-semibold">{fund.title}</h3>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {fund.subtitle}
          <span className="ml-2 text-ink-2">{fund.code}</span>
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          {t.periodStart} – {t.periodEnd}
        </p>
        <div className="mt-4 flex items-center gap-4">
          <RadialGauge pct={Math.min(100, spentPct)} hot={burnHot} />
          <div className="text-[13px] text-ink-2">
            <p className={burnHot ? "font-medium text-attention" : ""}>
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
          {topLines.map((bl, blIdx) => {
            const cap = t.lineVarianceLimitPct
              ? bl.lineBudget * (1 + t.lineVarianceLimitPct / 100)
              : bl.lineBudget;
            const fill = bl.lineBudget ? Math.min(100, (bl.lineSpent / bl.lineBudget) * 100) : 0;
            const capPct = bl.lineBudget ? Math.min(100, (cap / bl.lineBudget) * 100) : 100;
            return (
              <div key={`${bl.code}-${blIdx}`}>
                <div className="flex justify-between text-[12px]">
                  <span>
                    {bl.name} <span className="text-ink-2">{bl.code}</span>
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
      {deadlineHeadline && (
        <p
          className="mb-6 rounded-[6px] border border-attention/40 bg-attention-tint px-4 py-2.5 text-[14px] text-ink"
          role="status"
        >
          {deadlineHeadline}
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="font-display text-[40px] font-semibold leading-[1.15] text-ink">
            <span className="tabular text-redpen">
              $<CountUp value={clawDollars} durationMs={300} />
            </span>{" "}
            of <GlossaryTerm term="restricted funds">grant spending</GlossaryTerm> could be clawed back.
          </p>
          <p className="mt-3 text-[17px] text-ink-2">
            Steward checked {stats?.total ?? 0} transactions against {(grants ?? []).length} grant
            agreements. {needYou} need you
            {reportLine
              ? ` before the ${reportLine.title} report is due in ${reportLine.days} days.`
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
              Simulate Sept–Oct bank feed
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
          <FundBreakdown data={fundBreakdown} onNavigate={onFundNavigate} />
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">{grantCards}</div>

      <section className="mt-10">
        <h2 className="font-display text-[17px] font-semibold text-ink">Steward&apos;s day</h2>
        <ol className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          {timeline.steps.map((step, i) => (
            <li key={step.id} className="flex items-center gap-2">
              <span
                className={`flex items-center gap-2 rounded-[6px] border px-3 py-2 ${
                  i === timeline.active
                    ? "border-attention bg-attention-tint text-ink"
                    : "border-rule bg-sheet text-ink-2"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full bg-navy ${i === timeline.active && timeline.running ? "presence-dot-running" : ""}`}
                />
                {step.label}
              </span>
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
