"use client";

import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { fmtRisk, fmtSentenceAmount, fmtTableAmount, lineLabel, relativeTime } from "../format";
import { CaseFile } from "./CaseFile";
import { RedPenStrike } from "./RedPenStrike";
import { WhyDrawer } from "./WhyDrawer";

type Tab = "inbox" | "transactions" | "grants" | "report" | "proof";

const ACTORS = [
  { id: "approver", label: "A. Okafor (Executive Director)" },
  { id: "steward", label: "Steward (agent)" },
] as const;

export function StewardApp() {
  const counts = useQuery(api.ingest.counts);
  const stats = useQuery(api.ui.dashboardStats);
  const queue = useQuery(api.ui.inboxQueue);
  const run = useQuery(api.dashboard.latestRun);
  const audit = useQuery(api.ui.auditFeed);
  const grants = useQuery(api.ui.grantsSheets);
  const ledger = useQuery(api.ui.transactionLedger);

  const runAgent = useAction(api.agent.runAgent);

  const [tab, setTab] = useState<Tab>("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const [actor, setActor] = useState<(typeof ACTORS)[number]["id"]>("approver");
  const [whyOpen, setWhyOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [txnFilter, setTxnFilter] = useState<"all" | "clean" | "exceptions">("all");
  const [prevNeedYou, setPrevNeedYou] = useState<number | null>(null);
  const [countAnim, setCountAnim] = useState(false);
  const caseData = useQuery(api.ui.caseFile, selected ? { txnId: selected } : "skip");
  const grantList = useQuery(api.grants.list);
  const bothReady = (grantList ?? []).filter((g) => g.status === "ready").length >= 2;
  const showBadge = loaded || (counts && counts.transactions > 0);
  const actingAsSteward = actor === "steward";
  const actorName = ACTORS.find((a) => a.id === actor)!.label.split(" (")[0];

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

  async function loadDemo() {
    setSeedLoading(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      if (!res.ok) throw new Error("Seed failed");
      setLoaded(true);
    } finally {
      setSeedLoading(false);
    }
  }

  async function onRunSteward() {
    setRunLoading(true);
    try {
      await runAgent({});
    } finally {
      setRunLoading(false);
    }
  }

  const statusLine = useMemo(() => {
    if (run?.status === "running") {
      const n = stats?.total ?? counts?.transactions ?? 0;
      return `Steward is reviewing ${n} transactions…`;
    }
    if (!counts?.transactions) return null;
    if (stats?.needYou === 0) return "Everything reconciles. Nothing needs you.";
    if (!stats) return "Loading review…";
    return `Steward reviewed ${stats.total} transactions. ${stats.clean} are clean. ${stats.needYou} need you — ${fmtRisk(stats.atRiskCents)} at risk of disallowance.`;
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
            {seedLoading ? "Loading…" : "Load demo data"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-rule bg-sheet px-6 py-3 flex flex-wrap items-center gap-4">
        <span className="text-[17px] font-semibold">Steward</span>
        <span className="text-[15px] text-ink-2">Valencia Youth Collective</span>
        {showBadge && (
          <span className="rounded-[4px] border border-pencil/30 bg-pencil-wash px-2 py-0.5 text-[13px] text-pencil">
            Synthetic demo data
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-[13px]">
          <label htmlFor="actor" className="text-ink-2">
            Acting as
          </label>
          <select
            id="actor"
            className="rounded-[4px] border border-rule bg-sheet px-2 py-1 text-[13px]"
            value={actor}
            onChange={(e) => setActor(e.target.value as typeof actor)}
          >
            {ACTORS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="border-b border-rule bg-sheet px-6 py-4">
        <p
          className={`text-[32px] font-semibold leading-[1.2] ${stats?.needYou === 0 ? "text-ledger" : "text-ink"} ${countAnim ? "count-animate" : ""}`}
        >
          {statusLine}
        </p>
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
          <button type="button" onClick={() => void loadDemo()} disabled={seedLoading} className="text-ink-2 underline">
            Reload demo
          </button>
          <button
            type="button"
            disabled={!bothReady || runLoading || run?.status === "running"}
            onClick={() => void onRunSteward()}
            className="text-ledger underline disabled:opacity-40"
          >
            Run Steward
          </button>
        </div>
      </div>

      <nav className="flex gap-6 border-b border-rule bg-sheet px-6 text-[15px]">
        {(
          [
            ["inbox", "Inbox"],
            ["transactions", "Transactions"],
            ["grants", "Grants"],
            ["report", "Report"],
            ["proof", "Proof"],
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
              actorName={actorName}
              onToast={() => {}}
              onWhy={() => setWhyOpen(true)}
              strikeKey={selected ?? ""}
            />
          </section>
          <JournalPanel audit={audit} run={run} />
        </div>
      )}

      {tab === "transactions" && (
        <TransactionsTab ledger={ledger} filter={txnFilter} setFilter={setTxnFilter} />
      )}
      {tab === "grants" && <GrantsTab grants={grants} />}
      {tab === "report" && <ReportTab grants={grants} />}
      {tab === "proof" && <ProofTab run={run} />}

      <WhyDrawer txnId={selected} open={whyOpen} onClose={() => setWhyOpen(false)} />
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
  rows: { txnId: string; amountCents: number; description: string; reason: string; status: string; hasPrecedent?: boolean }[];
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
          <p className="truncate text-[13px] text-ink-2">
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
}: {
  audit: { at: string; actor: string; action: string; why: string; targetId: string }[] | undefined;
  run: { progress: string; status: string } | null | undefined;
}) {
  return (
    <aside className="overflow-y-auto bg-paper p-4">
      <h2 className="text-[13px] font-medium text-ink-2">Journal</h2>
      {run?.status === "running" && (
        <p className="journal-item-new mt-3 text-[13px] text-ink-2">{run.progress}</p>
      )}
      <ul className="mt-3 space-y-3">
        {(audit ?? []).map((a, i) => (
          <li key={`${a.at}-${i}`} className={i === 0 ? "journal-item-new text-[13px]" : "text-[13px]"}>
            <span className={a.actor === "steward" ? "text-ink-2" : "text-ink"}>
              {formatAudit(a)}
            </span>
            <span className="text-ink-2"> · {relativeTime(a.at)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function formatAudit(a: { actor: string; action: string; why: string; targetId: string }) {
  if (a.action === "extract_grant_terms") return `Extracted terms from ${a.targetId}.`;
  if (a.action === "decision") return a.why.slice(0, 120);
  if (a.action === "approve_entry") return `${a.actor} approved the reclass for ${a.targetId}.`;
  if (a.action === "precedent_recorded") return "Precedent recorded.";
  if (a.action === "defend_decision") return a.why.slice(0, 100);
  return a.why || a.action;
}

function TransactionsTab({
  ledger,
  filter,
  setFilter,
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
        status: string;
      }[]
    | undefined;
  filter: "all" | "clean" | "exceptions";
  setFilter: (f: "all" | "clean" | "exceptions") => void;
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
                    <RedPenStrike text={lineLabel(r.grantId, r.budgetLine)} className="text-[13px]" />
                  ) : (
                    lineLabel(r.grantId, r.budgetLine)
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

function GrantsTab({ grants }: { grants: { terms: unknown; spentByLine: Record<string, number> }[] | undefined }) {
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
                const pct = Math.min(100, (spent / budget) * 100);
                const over = spent > budget;
                const cap = t.lineVarianceLimitPct ? budget * (1 + t.lineVarianceLimitPct / 100) : budget;
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
                      <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
                      {over && <div className="absolute right-0 top-0 h-full w-2 bg-redpen" />}
                      {t.lineVarianceLimitPct && (
                        <div
                          className="absolute top-0 h-full w-px bg-ink-2"
                          style={{ left: `${Math.min(100, (cap / budget) * 100)}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <ul className="mt-6 space-y-2 border-t border-rule pt-4">
              {t.unallowable.map((u) => (
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

function ReportTab({ grants }: { grants: { terms: unknown }[] | undefined }) {
  return (
    <div className="max-w-[75ch] p-6 text-[15px]">
      <h2 className="text-[22px] font-semibold">Budget vs actual (draft)</h2>
      <p className="mt-2 text-ink-2">Funder report body uses grant terms and coded spend from Steward decisions.</p>
      {(grants ?? []).map((g, i) => {
        const t = g.terms as { grantId: string; program: string } | null;
        if (!t) return null;
        return (
          <p key={i} className="mt-4 font-serif text-[16px]">
            {t.program} ({t.grantId}) — figures reconcile to the transactions tab.
          </p>
        );
      })}
    </div>
  );
}

function ProofTab({ run }: { run: { usageInput: number; usageOutput: number } | null | undefined }) {
  const [evalData, setEvalData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/eval-result.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setEvalData)
      .catch(() => setEvalData(null));
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
            <td className="py-2">{(evalData?.issueRecall as string) ?? "—"}</td>
            <td className="py-2">{(evalData?.issuePrecision as string) ?? "—"}</td>
            <td className="py-2">{(evalData?.codingAccuracy as string) ?? "—"}</td>
            <td className="py-2">
              {run ? `${run.usageInput} in / ${run.usageOutput} out` : "—"}
            </td>
          </tr>
          <tr>
            <td className="py-2">Hold-out set</td>
            <td colSpan={4} className="py-2 text-ink-2">
              {evalData?.holdout ? String(evalData.holdout) : "No hold-out eval-result.json yet."}
            </td>
          </tr>
        </tbody>
      </table>
      {Array.isArray(evalData?.misses) && (evalData!.misses as string[]).length > 0 ? (
        <div>
          <p className="text-[13px] font-medium text-ink-2">Misses</p>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-ink-2">
            {(evalData!.misses as string[]).slice(0, 8).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
