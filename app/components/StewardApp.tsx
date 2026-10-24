"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { stewardCodingLabel } from "@/lib/codingLabel";
import type { GrantTerms } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { fmtRisk, fmtSentenceAmount, fmtTableAmount, relativeTime } from "../format";
import { getDemoPasscode, hasDemoWriteAccess, initDemoPasscodeFromUrl } from "../lib/demoPasscode";
import { messageFromConvexError } from "../lib/convexError";
import { CaseFile } from "./CaseFile";
import { RedPenStrike } from "./RedPenStrike";
import { WhyDrawer } from "./WhyDrawer";
import { YourDataTab } from "./YourDataTab";

type Tab = "inbox" | "transactions" | "grants" | "report" | "proof" | "yourdata";

const STEWARD_ACTOR = { id: "steward", label: "Steward (agent)" } as const;

export function StewardApp() {
  const counts = useQuery(api.ingest.counts);
  const stats = useQuery(api.ui.dashboardStats);
  const queue = useQuery(api.ui.inboxQueue);
  const run = useQuery(api.dashboard.latestRun);
  const audit = useQuery(api.ui.auditFeed);
  const grants = useQuery(api.ui.grantsSheets);
  const ledger = useQuery(api.ui.transactionLedger);

  const workspace = useQuery(api.settings.get);
  const demoGate = useQuery(api.demoAuth.gate);
  const runAgent = useAction(api.agent.runAgent);
  const resetRun = useMutation(api.ingest.resetRunState);
  const resetExtractErrors = useMutation(api.grants.resetExtractErrors);
  const extractGrant = useAction(api.agent.extractGrant);
  const regenerateNarrative = useAction(api.report.regenerateNarrative);
  const triggerMorningCheck = useMutation(api.deadlines.triggerMorningCheck);

  const [tab, setTab] = useState<Tab>("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const [actor, setActor] = useState<"approver" | "steward">("approver");
  const [whyOpen, setWhyOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [txnFilter, setTxnFilter] = useState<"all" | "clean" | "exceptions">("all");
  const [prevNeedYou, setPrevNeedYou] = useState<number | null>(null);
  const [countAnim, setCountAnim] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [passcodeReady, setPasscodeReady] = useState(false);
  const caseData = useQuery(api.ui.caseFile, selected ? { txnId: selected } : "skip");
  const grantList = useQuery(api.grants.list);
  const grantsReady = (grantList ?? []).filter((g) => g.status === "ready").length >= 1;
  const showBadge = loaded || (counts && counts.transactions > 0);
  const actingAsSteward = actor === "steward";
  const approverLabel = workspace?.approverLabel ?? "A. Okafor (Executive Director)";
  const actorLabel = actor === "steward" ? STEWARD_ACTOR.label : approverLabel;
  const orgDisplay = workspace?.organizationName ?? "Valencia Youth Collective";
  const isCustomData = workspace?.dataSource === "custom";
  const passcode = getDemoPasscode();
  const canWrite = passcodeReady && hasDemoWriteAccess(demoGate?.requiresPasscode ?? false);

  useEffect(() => {
    initDemoPasscodeFromUrl();
    setPasscodeReady(true);
  }, []);

  const exceptions = queue ?? [];
  useEffect(() => {
    if (!selected && exceptions.length) setSelected(exceptions[0].txnId);
  }, [exceptions, selected]);

  useEffect(() => {
    if (stats && prevNeedYou !== null && stats.needYou < prevNeedYou && stats.needYou === 0) {
      setCountAnim(true);
      const t = setTimeout(() => setCountAnim(false), 700);
      return () => clearTimeout(t);
    }
    if (stats) setPrevNeedYou(stats.needYou);
  }, [stats, prevNeedYou]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (tab !== "inbox" || !exceptions.length) return;
      const idx = exceptions.findIndex((x) => x.txnId === selected);
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setSelected(exceptions[Math.min(idx + 1, exceptions.length - 1)]?.txnId ?? selected);
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setSelected(exceptions[Math.max(idx - 1, 0)]?.txnId ?? selected);
      }
      if (e.key === "?" && selected) setWhyOpen(true);
    },
    [tab, exceptions, selected],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  async function loadDemo(opts?: { autoRun?: boolean }) {
    if (!canWrite) {
      setInlineError("View-only demo — add ?key= to the URL for write access.");
      return;
    }
    setSeedLoading(true);
    setInlineError(null);
    try {
      const res = await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: getDemoPasscode() }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error ?? "Seed failed");
      }
      setLoaded(true);
    } catch (e) {
      setInlineError(messageFromConvexError(e));
    } finally {
      setSeedLoading(false);
    }
  }

  async function onReset() {
    if (!canWrite) return;
    setInlineError(null);
    try {
      await resetRun({ passcode: getDemoPasscode() });
      setSelected(null);
    } catch (e) {
      setInlineError(messageFromConvexError(e));
    }
  }

  async function onRunSteward() {
    if (!canWrite) return;
    setRunLoading(true);
    setInlineError(null);
    try {
      await runAgent({ passcode: getDemoPasscode() });
    } catch (e) {
      setInlineError(messageFromConvexError(e));
    } finally {
      setRunLoading(false);
    }
  }

  async function bankFeedSeptOct() {
    if (!canWrite) return;
    setSeedLoading(true);
    setInlineError(null);
    try {
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: getDemoPasscode(), demoSeptOct: true }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; added?: number };
      if (!res.ok || body.ok === false) throw new Error(body.error ?? "Feed failed");
    } catch (e) {
      setInlineError(messageFromConvexError(e));
    } finally {
      setSeedLoading(false);
    }
  }

  async function retryGrant(grantDocId: string) {
    if (!canWrite) return;
    setInlineError(null);
    try {
      await resetExtractErrors({ passcode: getDemoPasscode() });
      await extractGrant({ grantDocId: grantDocId as never, passcode: getDemoPasscode() });
    } catch (e) {
      setInlineError(messageFromConvexError(e));
    }
  }

  const statusLine = useMemo(() => {
    if (run?.status === "running") {
      const n = stats?.total ?? counts?.transactions ?? 0;
      return `Steward is reviewing ${n} transactions…`;
    }
    if (!counts?.transactions) return null;
    if (stats?.needYou === 0 && counts?.transactions) return "Everything reconciles. Nothing needs you.";
    if (!stats) return "Loading review…";
    const resolved = stats.resolved ?? 0;
    const resolvedBit = resolved > 0 ? `, ${resolved} resolved` : "";
    return `Steward reviewed ${stats.total} transactions. ${stats.clean} are clean. ${stats.needYou} need you${resolvedBit} — ${fmtRisk(stats.atRiskCents)} of grant charges at risk.`;
  }, [run, stats, counts]);

  const blocked = exceptions.filter((e) => e.status === "blocked");
  const review = exceptions.filter((e) => e.status === "needs_review");

  if (!counts?.transactions) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-8">
        <div className="max-w-md text-center">
          <h1 className="text-[22px] font-semibold text-ink">Steward</h1>
          <p className="mt-3 text-[15px] text-ink-2">Load July–August to start</p>
          <button
            type="button"
            onClick={() => void loadDemo()}
            disabled={seedLoading}
            className="mt-6 rounded-[4px] bg-ledger px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {seedLoading ? "Loading…" : "Load July–August"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-rule bg-sheet px-6 py-3 flex flex-wrap items-center gap-4">
        <span className="text-[17px] font-semibold">Steward</span>
        <span className="text-[15px] text-ink-2">{orgDisplay}</span>
        {showBadge && !isCustomData && (
          <span className="rounded-[4px] border border-pencil/30 bg-pencil-wash px-2 py-0.5 text-[13px] text-pencil">
            Synthetic demo data
          </span>
        )}
        {isCustomData && (
          <span className="rounded-[4px] border border-rule px-2 py-0.5 text-[13px] text-ink-2">
            Your data — not stored beyond this demo workspace
          </span>
        )}
        {passcodeReady && demoGate?.requiresPasscode && !canWrite && (
          <span className="text-[13px] text-ink-2">View-only demo</span>
        )}
        <div className="ml-auto flex items-center gap-2 text-[13px]">
          <label htmlFor="actor" className="text-ink-2">
            Acting as
          </label>
          <select
            id="actor"
            className="rounded-[4px] border border-rule bg-sheet px-2 py-1 text-[13px]"
            value={actor}
            onChange={(e) => setActor(e.target.value as "approver" | "steward")}
          >
            <option value="approver">{approverLabel}</option>
            <option value="steward">{STEWARD_ACTOR.label}</option>
          </select>
        </div>
      </header>

      <div className="border-b border-rule bg-sheet px-6 py-4">
        <p
          className={`text-[32px] font-semibold leading-[1.2] ${stats?.needYou === 0 ? "text-ledger" : "text-ink"} ${countAnim ? "count-animate" : ""}`}
        >
          {statusLine}
          {stats && stats.atRiskCents > 0 && stats.needYou > 0 && (
            <span className="relative ml-2 inline-block align-middle">
              <button
                type="button"
                aria-label="At-risk breakdown"
                className="text-[15px] font-normal text-ink-2 underline"
                onClick={() => setRiskOpen((o) => !o)}
              >
                ⓘ
              </button>
              {riskOpen && (
                <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-[6px] border border-rule bg-sheet p-3 text-[13px] font-normal text-ink shadow-none">
                  <p className="font-medium text-ink-2">At-risk breakdown</p>
                  <ul className="mt-2 space-y-1">
                    {(stats.atRiskBreakdown ?? []).map((b) => (
                      <li key={b.label} className="flex justify-between gap-2">
                        <span>{b.label}</span>
                        <span className="tabular">{fmtRisk(b.cents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </span>
          )}
        </p>
        {(inlineError || statusNote) && (
          <p className="mt-2 text-[13px] text-redpen" role="alert">
            {inlineError ?? statusNote}
          </p>
        )}
        {run?.status === "error" && run.errors.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-redpen">{run.errors[0]}</p>
            <button
              type="button"
              onClick={() => void onRunSteward()}
              className="rounded-[4px] border border-redpen px-2 py-1 text-[13px] text-redpen"
            >
              Retry run
            </button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
          <button type="button" onClick={() => void onReset()} className="text-ink-2 underline">
            Reset
          </button>
          <button type="button" onClick={() => void loadDemo()} disabled={seedLoading} className="text-ink-2 underline">
            Load July–August
          </button>
          <button
            type="button"
            onClick={() => void bankFeedSeptOct()}
            disabled={seedLoading || !counts?.transactions}
            className="text-ledger underline disabled:opacity-40"
          >
            Bank feed: September–October arrives
          </button>
          <button
            type="button"
            disabled={!canWrite || !grantsReady || runLoading || run?.status === "running"}
            onClick={() => void onRunSteward()}
            className="text-ledger underline disabled:opacity-40"
          >
            Run Steward
          </button>
        </div>
        {(grantList ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(grantList ?? []).map((g) => (
              <span
                key={g._id}
                className={`inline-flex items-center gap-2 rounded-[4px] border px-2 py-1 text-[13px] ${
                  g.status === "ready"
                    ? "border-ledger/40 text-ledger"
                    : g.status === "error"
                      ? "border-redpen/40 text-redpen"
                      : "border-rule text-ink-2"
                }`}
              >
                {g.fileName.replace(".pdf", "")}: {g.status}
                {g.status === "error" && g.error && (
                  <span className="max-w-[200px] truncate" title={g.error}>
                    {g.error}
                  </span>
                )}
                {g.status === "error" && canWrite && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void retryGrant(g._id)}
                  >
                    Retry
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <nav className="flex gap-6 border-b border-rule bg-sheet px-6 text-[15px]">
        {(
          [
            ["inbox", "Inbox"],
            ["transactions", "Transactions"],
            ["grants", "Grants"],
            ["report", "Report"],
            ["proof", "Proof"],
            ["yourdata", "Your data"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border-b-2 py-3 ${tab === id ? "border-ledger font-medium text-ink" : "border-transparent text-ink-2"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "inbox" && (
        <div className="grid min-h-[calc(100vh-220px)] grid-cols-[300px_1fr_280px]">
          <aside className="border-r border-rule bg-paper">
            {blocked.length > 0 && (
              <QueueGroup title={`Blocked  ${blocked.length}`} rows={blocked} selected={selected} onSelect={setSelected} />
            )}
            {review.length > 0 && (
              <QueueGroup title={`Review  ${review.length}`} rows={review} selected={selected} onSelect={setSelected} />
            )}
            {exceptions.length === 0 && (
              <p className="p-4 text-[15px] text-ledger">Everything reconciles. Nothing needs you.</p>
            )}
          </aside>
          <section className="relative border-r border-rule bg-sheet">
            <CaseFile
              data={caseData}
              actingAsSteward={actingAsSteward}
              actorLabel={actorLabel}
              passcode={getDemoPasscode()}
              canWrite={canWrite}
              onStatusLine={setStatusNote}
              onWhy={() => setWhyOpen(true)}
              strikeKey={selected ?? ""}
            />
          </section>
          <JournalPanel
            audit={audit}
            run={run}
            canWrite={canWrite}
            onMorningCheck={() => triggerMorningCheck({ passcode: getDemoPasscode() })}
          />
        </div>
      )}

      {tab === "transactions" && (
        <TransactionsTab
          ledger={ledger}
          filter={txnFilter}
          setFilter={setTxnFilter}
          grantTerms={(grants ?? []).map((g) => g.terms as GrantTerms).filter(Boolean)}
        />
      )}
      {tab === "grants" && <GrantsTab grants={grants} />}
      {tab === "report" && (
        <ReportTab
          grants={grants}
          canWrite={canWrite}
          regenerateNarrative={(args) => regenerateNarrative({ ...args, passcode: getDemoPasscode() })}
        />
      )}
      {tab === "proof" && <ProofTab run={run} />}
      {tab === "yourdata" && (
        <YourDataTab
          canWrite={canWrite}
          onError={setInlineError}
          onRunStarted={() => setTab("inbox")}
        />
      )}

      <WhyDrawer
        txnId={selected}
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        passcode={getDemoPasscode()}
        canWrite={canWrite}
      />
    </div>
  );
}

function QueueGroup({
  title,
  rows,
  selected,
  onSelect,
}: {
  title: string;
  rows: {
    txnId: string;
    amountCents: number;
    description: string;
    reason: string;
    ruleId?: string | null;
    status: string;
    hasPrecedent?: boolean;
  }[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <p className="px-3 py-2 text-[13px] font-medium text-ink-2">{title}</p>
      {rows.map((r) => (
        <button
          key={r.txnId}
          type="button"
          onClick={() => onSelect(r.txnId)}
          className={`flex h-14 w-full flex-col justify-center border-l-[3px] px-3 text-left ${
            r.status === "blocked" ? "border-l-redpen" : "border-l-pencil"
          } ${selected === r.txnId ? "border-l-ink bg-sheet" : "border-l-transparent hover:bg-sheet/60"}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-medium">{r.description}</span>
            <span className="tabular shrink-0 text-[15px] font-semibold">{fmtTableAmount(r.amountCents)}</span>
          </div>
          <p className="line-clamp-2 text-[13px] text-ink-2" title={r.ruleId ?? undefined}>
            {r.reason}
            {r.hasPrecedent ? " Ⓟ" : ""}
          </p>
        </button>
      ))}
    </div>
  );
}

function JournalPanel({
  audit,
  run,
  canWrite,
  onMorningCheck,
}: {
  audit: { at: string; actor: string; action: string; why: string; targetId: string }[] | undefined;
  run: { progress: string; status: string } | null | undefined;
  canWrite: boolean;
  onMorningCheck: () => void;
}) {
  return (
    <aside className="overflow-y-auto bg-paper p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-ink-2">Journal</h2>
        {canWrite && (
          <button type="button" className="text-[12px] text-ledger underline" onClick={onMorningCheck}>
            Run morning check
          </button>
        )}
      </div>
      {run?.status === "running" && (
        <p className="journal-item-new mt-3 text-[13px] text-ink-2">{run.progress}</p>
      )}
      <ul className="mt-3 space-y-3">
        {(audit ?? []).map((a, i) => (
          <li
            key={`${a.at}-${i}`}
            className={`${i === 0 ? "journal-item-new" : ""} whitespace-normal text-[13px] leading-[1.45]`}
          >
            <span className={a.actor === "steward" ? "text-ink-2" : "text-ink"}>{formatAudit(a)}</span>
            <span className="text-ink-2"> · {relativeTime(a.at)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function formatAudit(a: { actor: string; action: string; why: string; targetId: string }) {
  if (a.action === "run_summary") return a.why;
  if (a.action === "extract_grant_terms") return `Extracted terms from ${a.targetId}.`;
  if (a.action === "approve_entry") return `${a.actor} approved the reclass for ${a.targetId}.`;
  if (a.action === "precedent_recorded") return "Precedent recorded.";
  if (a.action === "defend_decision") return a.why;
  return a.why || a.action;
}

function TransactionsTab({
  ledger,
  filter,
  setFilter,
  grantTerms,
}: {
  ledger:
    | {
        txnId: string;
        date: string;
        description: string;
        memo: string;
        amountCents: number;
        grantId: string | null;
        budgetLine: string | null;
        splits?: unknown;
        status: string;
      }[]
    | undefined;
  filter: "all" | "clean" | "exceptions";
  setFilter: (f: "all" | "clean" | "exceptions") => void;
  grantTerms: GrantTerms[];
}) {
  const rows = (ledger ?? []).filter((r) => {
    if (filter === "clean") return r.status === "auto";
    if (filter === "exceptions") return r.status !== "auto";
    return true;
  });
  return (
    <div className="p-6">
      <div className="mb-4 flex gap-4 text-[13px]">
        {(["all", "clean", "exceptions"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={filter === f ? "font-medium text-ledger underline" : "text-ink-2"}
          >
            {f === "all" ? "All" : f === "clean" ? "Clean" : "Exceptions"}
          </button>
        ))}
      </div>
      <div className="max-h-[70vh] overflow-auto border border-rule bg-sheet">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-sheet">
            <tr className="border-b border-rule text-left text-ink-2">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Memo</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Steward&apos;s coding</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.txnId} className="h-10 border-b border-rule">
                <td className="px-3 py-2">{r.date}</td>
                <td className="max-w-[200px] truncate px-3 py-2">{r.description}</td>
                <td className="max-w-[120px] truncate px-3 py-2 text-ink-2">{r.memo}</td>
                <td className="tabular px-3 py-2 text-right">{fmtTableAmount(r.amountCents)}</td>
                <td className="px-3 py-2">
                  {r.status === "blocked" && r.grantId ? (
                    <RedPenStrike
                      text={stewardCodingLabel({
                        amountCents: r.amountCents,
                        grantId: r.grantId,
                        budgetLine: r.budgetLine,
                        grants: grantTerms,
                        description: r.description,
                        memo: r.memo,
                      })}
                      className="text-[13px]"
                    />
                  ) : (
                    stewardCodingLabel({
                      amountCents: r.amountCents,
                      grantId: r.grantId,
                      budgetLine: r.budgetLine,
                      splits: r.splits as { grantId: string | null; budgetLine: string | null; amount: number }[] | undefined,
                      grants: grantTerms,
                      description: r.description,
                      memo: r.memo,
                    })
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.status === "auto" ? (
                    <span className="text-ledger">✓</span>
                  ) : (
                    <span className={r.status === "blocked" ? "text-redpen" : "text-pencil"}>{r.status.replace("_", " ")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrantsTab({
  grants,
}: {
  grants:
    | {
        terms: unknown;
        spentByLine: Record<string, number>;
        lineMeta?: Record<string, { overCents: number; overPct: number }>;
      }[]
    | undefined;
}) {
  return (
    <div className="space-y-8 p-6">
      {(grants ?? []).map((g, i) => {
        const t = g.terms as {
          grantId: string;
          funder: string;
          periodStart: string;
          periodEnd: string;
          totalAward: number;
          budgetLines: { code: string; name: string; amount: number }[];
          lineVarianceLimitPct: number | null;
          unallowable: { rule: string; clauseRef: string }[];
        } | null;
        if (!t) return null;
        return (
          <article key={i} className="border border-rule bg-sheet p-6">
            <h2 className="text-[22px] font-semibold">{t.grantId}</h2>
            <p className="mt-1 text-[13px] text-ink-2">
              {t.funder} · {t.periodStart} to {t.periodEnd} · {fmtSentenceAmount(t.totalAward * 100)}
            </p>
            <div className="mt-6 space-y-4">
              {t.budgetLines.map((bl) => {
                const spent = g.spentByLine[`${t.grantId}:${bl.code}`] ?? 0;
                const budget = bl.amount * 100;
                const cap = t.lineVarianceLimitPct ? budget * (1 + t.lineVarianceLimitPct / 100) : budget;
                const spentPct = budget ? Math.min(100, (spent / budget) * 100) : 0;
                const capPct = budget ? Math.min(100, (cap / budget) * 100) : 100;
                const overMeta = g.lineMeta?.[`${t.grantId}:${bl.code}`];
                const overBarPct = budget && spent > budget ? Math.min(100, ((spent - budget) / budget) * 100) : 0;
                return (
                  <div key={bl.code}>
                    <div className="flex justify-between text-[13px]">
                      <span>
                        {bl.code} {bl.name}
                      </span>
                      <span className="tabular text-ink-2">
                        {fmtTableAmount(spent)} / {fmtTableAmount(budget)}
                      </span>
                    </div>
                    <div className="relative mt-1 h-1.5 bg-rule">
                      <div className="h-full bg-ink" style={{ width: `${spentPct}%` }} />
                      {overBarPct > 0 && (
                        <div
                          className="absolute top-0 h-full bg-redpen"
                          style={{ left: `${Math.min(100, 100 - overBarPct)}%`, width: `${overBarPct}%` }}
                        />
                      )}
                      {t.lineVarianceLimitPct && (
                        <div
                          className="absolute top-0 h-full w-px bg-ink-2"
                          style={{ left: `${capPct}%` }}
                        />
                      )}
                    </div>
                    {overMeta && (
                      <p className="mt-1 text-[13px] text-redpen">
                        Over by {fmtRisk(overMeta.overCents)} ({overMeta.overPct}%) — needs program officer approval
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <ul className="mt-6 space-y-2 border-t border-rule pt-4">
              {(t.unallowable ?? []).map((u) => (
                <li key={u.clauseRef} className="text-[15px]">
                  <span className="font-serif text-[16px]">{u.rule}</span>
                  <span className="mt-1 block text-[13px] text-ink-2">{u.clauseRef}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

function ReportTab({
  grants,
  canWrite,
  regenerateNarrative,
}: {
  grants: { terms: unknown }[] | undefined;
  canWrite: boolean;
  regenerateNarrative: (args: { grantId: string }) => Promise<string>;
}) {
  const grantIds = (grants ?? [])
    .map((g) => (g.terms as { grantId?: string } | null)?.grantId)
    .filter(Boolean) as string[];
  return (
    <div className="report-print space-y-10 p-6 text-[15px]">
      {grantIds.map((gid) => (
        <GrantReportSheet key={gid} grantId={gid} canWrite={canWrite} regenerateNarrative={regenerateNarrative} />
      ))}
      <button
        type="button"
        className="no-print rounded-[4px] border border-rule px-4 py-2 text-[15px]"
        onClick={() => window.print()}
      >
        Print / Save PDF
      </button>
    </div>
  );
}

function GrantReportSheet({
  grantId,
  canWrite,
  regenerateNarrative,
}: {
  grantId: string;
  canWrite: boolean;
  regenerateNarrative: (args: { grantId: string }) => Promise<string>;
}) {
  const data = useQuery(api.report.grantReportData, { grantId });
  const [narrative, setNarrative] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  if (!data) return null;
  const { terms, lines, excludedCount, excludedCents } = data;
  return (
    <article className="border border-rule bg-sheet p-6">
      <h2 className="text-[22px] font-semibold">Funder report — draft</h2>
      <p className="mt-1 text-[13px] text-ink-2">
        {terms.grantId} · {terms.funder}
      </p>
      <p className="mt-4 font-serif text-[16px] leading-[1.45] text-ink">
        {narrative ?? "Generate a narrative from the figures below."}
      </p>
      {narrativeError && <p className="mt-2 text-[13px] text-redpen">{narrativeError}</p>}
      <button
        type="button"
        disabled={busy || !canWrite}
        className="no-print mt-3 text-[13px] text-ledger underline disabled:opacity-40"
        onClick={() => {
          setBusy(true);
          setNarrativeError(null);
          void regenerateNarrative({ grantId })
            .then(setNarrative)
            .catch((e) => setNarrativeError(messageFromConvexError(e)))
            .finally(() => setBusy(false));
        }}
      >
        Regenerate
      </button>
      <table className="mt-6 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule text-left text-ink-2">
            <th className="py-2 font-medium">Line</th>
            <th className="py-2 text-right font-medium">Budget</th>
            <th className="py-2 text-right font-medium">Actual this period</th>
            <th className="py-2 text-right font-medium">Remaining</th>
            <th className="py-2 text-right font-medium">% used</th>
            <th className="py-2 font-medium">Variance flag</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.code} className="border-b border-rule">
              <td className="py-2">
                {l.code} {l.name}
              </td>
              <td className="tabular py-2 text-right">{fmtTableAmount(l.budget)}</td>
              <td className="tabular py-2 text-right">{fmtTableAmount(l.actual)}</td>
              <td className="tabular py-2 text-right">{fmtTableAmount(l.remaining)}</td>
              <td className="tabular py-2 text-right">{Math.round(l.pct)}%</td>
              <td className="py-2">{l.over ? "Over variance cap" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {excludedCount > 0 && (
        <p className="mt-4 text-[13px] text-ink-2">
          Excluded pending your review: {excludedCount} items, {fmtRisk(excludedCents)}
        </p>
      )}
      <p className="mt-6 text-[13px] text-ink-2">
        Prepared by Steward · Reviewed by: ________________ (requires approver)
      </p>
    </article>
  );
}

function ProofTab({ run }: { run: { usageInput: number; usageOutput: number } | null | undefined }) {
  const [demoEval, setDemoEval] = useState<Record<string, unknown> | null>(null);
  const [holdout, setHoldout] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/eval-result.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setDemoEval)
      .catch(() => setDemoEval(null));
    fetch("/eval-result-holdout.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setHoldout)
      .catch(() => setHoldout(null));
  }, []);
  return (
    <div className="max-w-[75ch] space-y-6 p-6 text-[15px]">
      <h2 className="text-[22px] font-semibold">How we know it works</h2>
      <p className="text-ink-2">
        Demo set uses synthetic Valencia Youth Collective data. Model calls are real; funders and transactions are fictional.
      </p>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule text-left text-ink-2">
            <th className="py-2 font-medium">Set</th>
            <th className="py-2 font-medium">Recall</th>
            <th className="py-2 font-medium">Precision</th>
            <th className="py-2 font-medium">Clean accuracy</th>
            <th className="py-2 font-medium">Tokens</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-rule">
            <td className="py-2">Demo set</td>
            <td className="py-2">{(demoEval?.issueRecall as string) ?? "—"}</td>
            <td className="py-2">{(demoEval?.issuePrecision as string) ?? "—"}</td>
            <td className="py-2">{(demoEval?.codingAccuracy as string) ?? "—"}</td>
            <td className="py-2">
              {run ? `${run.usageInput} in / ${run.usageOutput} out` : "—"}
            </td>
          </tr>
          <tr className="border-b border-rule">
            <td className="py-2">Hold-out set</td>
            <td className="py-2">{((holdout?.recall ?? holdout?.issueRecall) as string) ?? "—"}</td>
            <td className="py-2">{((holdout?.precision ?? holdout?.issuePrecision) as string) ?? "—"}</td>
            <td className="py-2">{((holdout?.cleanRowAccuracy ?? holdout?.codingAccuracy) as string) ?? "—"}</td>
            <td className="py-2 text-ink-2">
              {holdout?.tokens
                ? `${(holdout.tokens as { input: number; output: number }).input} in / ${(holdout.tokens as { input: number; output: number }).output} out`
                : holdout
                  ? "—"
                  : "No hold-out eval yet."}
            </td>
          </tr>
        </tbody>
      </table>
      {Array.isArray(demoEval?.misses) && (demoEval!.misses as string[]).length > 0 ? (
        <div>
          <p className="text-[13px] font-medium text-ink-2">Misses</p>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-ink-2">
            {(demoEval!.misses as string[]).slice(0, 8).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
