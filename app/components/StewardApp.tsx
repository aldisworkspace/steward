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
import { CaseSkeleton } from "./CaseSkeleton";
import { CommandPalette, type Command } from "./CommandPalette";
import { ContextPanel, type PanelMode } from "./ContextPanel";
import { StatusBar } from "./StatusBar";
import { InboxQueue } from "./InboxQueue";
import { NavRail } from "./NavRail";
import { OverviewTab } from "./OverviewTab";
import { RedPenStrike } from "./RedPenStrike";
import { TopBar } from "./TopBar";
import { KeyboardHelp } from "./KeyboardHelp";
import { TransactionsVirtualTable } from "./TransactionsVirtualTable";
import { YourDataTab } from "./YourDataTab";
import { useAppUrlState } from "../hooks/useAppUrlState";

const STEWARD_ACTOR = { id: "steward", label: "Steward (agent)" } as const;

export function StewardApp() {
  const { tab, caseId, inboxFilter, txnFilter, setTab, setCaseId, setInboxFilter, setTxnFilter } =
    useAppUrlState();
  const counts = useQuery(api.ingest.counts);
  const needsOverview = tab === "overview" || tab === "inbox";
  const stats = useQuery(api.ui.dashboardStats, needsOverview ? {} : "skip");
  const queue = useQuery(api.ui.inboxQueue, tab === "inbox" ? {} : "skip");
  const resolvedQueue = useQuery(api.ui.inboxResolved, tab === "inbox" && inboxFilter === "resolved" ? {} : "skip");
  const run = useQuery(api.dashboard.latestRun);
  const audit = useQuery(api.ui.auditFeed, tab === "overview" ? {} : "skip");
  const grants = useQuery(
    api.ui.grantsSheets,
    tab === "overview" || tab === "grants" || tab === "report" || tab === "inbox" ? {} : "skip",
  );
  const ledger = useQuery(
    api.ui.transactionLedger,
    tab === "transactions" || tab === "overview" ? {} : "skip",
  );

  const workspace = useQuery(api.settings.get);
  const demoGate = useQuery(api.demoAuth.gate);
  const runAgent = useAction(api.agent.runAgent);
  const resetRun = useMutation(api.ingest.resetRunState);
  const undoApprove = useMutation(api.approvals.undoApproveEntry);
  const undoResolution = useMutation(api.approvals.undoInboxResolution);
  const approveEntry = useMutation(api.approvals.approveEntry);
  const regenerateNarrative = useAction(api.report.regenerateNarrative);
  const triggerMorningCheck = useMutation(api.deadlines.triggerMorningCheck);

  const [cmdOpen, setCmdOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [actor, setActor] = useState<"approver" | "steward">("approver");
  const selected = caseId;
  const setSelected = setCaseId;
  const [loaded, setLoaded] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [passcodeReady, setPasscodeReady] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [statusToast, setStatusToast] = useState<{
    message: string;
    undo?: () => void;
  } | null>(null);
  const caseData = useQuery(
    api.ui.caseFile,
    tab === "inbox" && selected ? { txnId: selected } : "skip",
  );
  const spentByLine = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of grants ?? []) {
      Object.assign(m, g.spentByLine);
    }
    return m;
  }, [grants]);
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

  useEffect(() => {
    if (!statusToast) return;
    const t = setTimeout(() => setStatusToast(null), 6000);
    return () => clearTimeout(t);
  }, [statusToast]);

  const exceptions = queue ?? [];
  useEffect(() => {
    if (tab !== "inbox" || inboxFilter === "resolved") return;
    if (!selected && exceptions.length) setSelected(exceptions[0].txnId);
  }, [tab, inboxFilter, exceptions, selected, setSelected]);

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
      if (e.key === "?" && selected) setPanelMode("why");
      else if (e.key === "?") setHelpOpen(true);
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

  useEffect(() => {
    function onCmd(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    }
    window.addEventListener("keydown", onCmd);
    return () => window.removeEventListener("keydown", onCmd);
  }, []);

  const paletteCommands = useMemo((): Command[] => {
    const next = exceptions[0];
    return [
      {
        id: "review-next",
        label: "Review next item",
        run: () => {
          setTab("inbox");
          if (next) setSelected(next.txnId);
        },
      },
      {
        id: "run",
        label: "Run Steward",
        run: () => void onRunSteward(),
      },
      {
        id: "feed",
        label: "Bank feed arrives",
        run: () => void bankFeedSeptOct(),
      },
      {
        id: "report",
        label: "Draft funder report",
        run: () => setTab("report"),
      },
      {
        id: "why",
        label: "Ask Steward why…",
        run: () => {
          setTab("inbox");
          setPanelMode("why");
        },
      },
      {
        id: "actor",
        label: "Switch acting user",
        run: () => setActor((a) => (a === "approver" ? "steward" : "approver")),
      },
    ];
  }, [exceptions]);

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
            className="mt-6 rounded-[6px] bg-money px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {seedLoading ? "Loading…" : "Load July–August"}
          </button>
        </div>
      </div>
    );
  }

  const inboxRows =
    inboxFilter === "resolved"
      ? (resolvedQueue ?? []).map((r) => ({ ...r, resolved: true as const }))
      : exceptions.map((r) => ({ ...r, resolved: false as const }));

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <TopBar
        orgDisplay={orgDisplay}
        showSyntheticBadge={!!showBadge}
        isCustomData={isCustomData}
        viewOnly={passcodeReady && !!demoGate?.requiresPasscode && !canWrite}
        runStatus={run?.status}
        runProgress={run?.progress}
        actor={actor}
        setActor={setActor}
        approverLabel={approverLabel}
        stewardLabel={STEWARD_ACTOR.label}
        onOpenCommand={() => setCmdOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <NavRail tab={tab} onTab={setTab} inboxCount={stats?.needYou ?? 0} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end gap-3 border-b border-rule bg-sheet px-4 py-2 text-[13px] text-ink-2">
            <button type="button" onClick={() => void onReset()} className="underline">
              Reset
            </button>
            <button type="button" onClick={() => void loadDemo()} disabled={seedLoading} className="underline">
              Reload demo
            </button>
            {tab === "overview" && canWrite && (
              <button
                type="button"
                className="text-money underline"
                onClick={() => triggerMorningCheck({ passcode: getDemoPasscode() })}
              >
                Run morning check
              </button>
            )}
          </div>
      {(inlineError || statusNote) && (
        <p className="px-4 py-2 text-[13px] text-redpen" role="alert">
          {inlineError ?? statusNote}
        </p>
      )}
      {run?.status === "error" && run.errors.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2">
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

          <main className="mx-auto w-full max-w-[1320px] flex-1 px-2 py-2 sm:px-4">
      {tab === "overview" && (
        <OverviewTab
          stats={stats ?? undefined}
          grants={grants}
          ledger={ledger}
          queue={exceptions}
          runStatus={run?.status}
          runProgress={run?.progress}
          audit={audit}
          onReviewInbox={() => setTab("inbox")}
          onBankFeed={() => void bankFeedSeptOct()}
          onDraftReport={() => setTab("report")}
          onSankeyOutcome={(outcome) => {
            setInboxFilter(outcome === "disallowed" ? "disallowed" : "all");
          }}
          onJournalFilter={() => {}}
        />
      )}

      {tab === "inbox" && (
        <div className="grid min-h-[calc(100vh-8rem)] grid-cols-12 gap-2">
          <div className="col-span-12 lg:col-span-4">
            <InboxQueue
              rows={inboxRows}
              selected={selected}
              onSelect={setSelected}
              filter={inboxFilter}
              setFilter={setInboxFilter}
              onApproveAll={(txnIds) => {
                if (!canWrite || actingAsSteward) return;
                const rowsByTxn = new Map(inboxRows.map((r) => [r.txnId, r]));
                void (async () => {
                  const approved: { entryId: string }[] = [];
                  try {
                    for (const txnId of txnIds) {
                      const entryId = rowsByTxn.get(txnId)?.entryId;
                      if (!entryId) continue;
                      await approveEntry({
                        entryId,
                        by: actorLabel,
                        note: "Approved as part of grouped payroll review",
                        passcode: getDemoPasscode(),
                      });
                      approved.push({ entryId });
                    }
                    if (approved.length) {
                      setStatusToast({
                        message: `${approved.length} entries approved`,
                        undo: () => {
                          for (const { entryId } of approved) {
                            void undoApprove({
                              entryId,
                              by: actorLabel,
                              passcode: getDemoPasscode(),
                            });
                          }
                        },
                      });
                      const rest = exceptions.filter((e) => !txnIds.includes(e.txnId));
                      setSelected(rest[0]?.txnId ?? null);
                    }
                  } catch (e) {
                    setInlineError(messageFromConvexError(e));
                  }
                })();
              }}
            />
          </div>
          <section className="relative col-span-12 min-h-[480px] rounded-[8px] border border-rule bg-sheet lg:col-span-8">
            {caseData === undefined && selected ? (
              <CaseSkeleton />
            ) : (
              <CaseFile
                data={caseData}
                spentByLine={spentByLine}
                actingAsSteward={actingAsSteward}
                actorLabel={actorLabel}
                passcode={getDemoPasscode()}
                canWrite={canWrite}
                onStatusLine={setStatusNote}
                onWhy={() => setPanelMode("why")}
                onResolved={() => {
                  const rest = exceptions.filter((e) => e.txnId !== selected);
                  setSelected(rest[0]?.txnId ?? null);
                }}
                onActionDone={(info) => {
                  if (info.kind === "approve") {
                    setStatusToast({
                      message: "Entry approved",
                      undo: () =>
                        void undoApprove({
                          entryId: info.entryId,
                          by: actorLabel,
                          passcode: getDemoPasscode(),
                        }),
                    });
                  } else {
                    setStatusToast({
                      message: "Decision recorded",
                      undo: () =>
                        void undoResolution({
                          txnId: info.txnId,
                          by: actorLabel,
                          passcode: getDemoPasscode(),
                        }),
                    });
                  }
                }}
                strikeKey={selected ?? ""}
              />
            )}
          </section>
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
          </main>
        </div>
      </div>
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        commands={paletteCommands}
        transactions={ledger ?? []}
        onJumpTxn={(txnId) => setSelected(txnId)}
      />
      <ContextPanel
        mode={panelMode}
        onClose={() => setPanelMode(null)}
        txnId={selected}
        passcode={getDemoPasscode()}
        canWrite={canWrite}
      />
      <StatusBar
        message={statusToast?.message ?? ""}
        undoLabel={statusToast?.undo ? "Undo" : undefined}
        onUndo={statusToast?.undo}
      />
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function JournalPanel({
  audit,
  run,
  canWrite,
  onMorningCheck,
  filterAction,
  onClearFilter,
}: {
  audit: { at: string; actor: string; action: string; why: string; targetId: string }[] | undefined;
  run: { progress: string; status: string } | null | undefined;
  canWrite: boolean;
  onMorningCheck: () => void;
  filterAction: string | null;
  onClearFilter: () => void;
}) {
  const rows = (audit ?? []).filter((a) => !filterAction || a.action === filterAction);
  return (
    <aside className="overflow-y-auto bg-paper p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-ink-2">Journal</h2>
        <div className="flex gap-2">
          {filterAction && (
            <button type="button" className="text-[12px] text-sky underline" onClick={onClearFilter}>
              Clear filter
            </button>
          )}
          {canWrite && (
            <button type="button" className="text-[12px] text-money underline" onClick={onMorningCheck}>
              Run morning check
            </button>
          )}
        </div>
      </div>
      {run?.status === "running" && (
        <p className="mt-3 text-[13px] text-ink-2">{run.progress}</p>
      )}
      <ul className="mt-3 space-y-3">
        {rows.map((a, i) => (
          <li
            key={`${a.at}-${i}`}
            className="whitespace-normal text-[13px] leading-[1.45]"
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
  filter: "all" | "clean" | "exceptions" | "blocked";
  setFilter: (f: "all" | "clean" | "exceptions" | "blocked") => void;
  grantTerms: GrantTerms[];
}) {
  const rows = (ledger ?? []).filter((r) => {
    if (filter === "clean") return r.status === "auto";
    if (filter === "blocked") return r.status === "blocked";
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
      {rows.length > 150 ? (
        <TransactionsVirtualTable rows={rows} grantTerms={grantTerms} />
      ) : (
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
                      <span className="text-money">✓</span>
                    ) : (
                      <span className={r.status === "blocked" ? "text-redpen" : "text-attention"}>
                        {r.status.replace("_", " ")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
