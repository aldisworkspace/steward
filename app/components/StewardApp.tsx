"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import { resolveCaseDeepLink } from "@/lib/caseDeepLink";
import type { GrantTerms } from "@/lib/types";
import { getDemoPasscode, hasDemoWriteAccess } from "../lib/demoPasscode";
import { messageFromConvexError } from "../lib/convexError";
import { useAppUrlState } from "../hooks/useAppUrlState";
import { useClientPasscodeReady } from "../hooks/useClientPasscodeReady";
import { useAdminMode } from "../hooks/useAdminMode";
import { useConvexConnection } from "../hooks/useConvexConnection";
import { AppContext, type AppCtx, type Person } from "./AppContext";
import { AppLoadingShell } from "./AppLoadingShell";
import { CommandPalette, type Command } from "./CommandPalette";
import { ContextPanel, type PanelMode } from "./ContextPanel";
import { KeyboardHelp } from "./KeyboardHelp";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { Button } from "./ui/Button";
import { DataView } from "./views/DataView";
import { PackagesView } from "./views/PackagesView";
import { PackageView } from "./views/PackageView";
import { ReviewView } from "./views/ReviewView";

const ACTOR_KEY = "steward_actor";

const actorListeners = new Set<() => void>();
let memActor: string | null = null;

function readStoredActor(): string | null {
  try {
    return localStorage.getItem(ACTOR_KEY) ?? memActor;
  } catch {
    return memActor;
  }
}

function subscribeActor(cb: () => void) {
  actorListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    actorListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function StewardApp() {
  const url = useAppUrlState();
  const { tab, needsRewrite, legacyView, caseSlug, setParams, setTab } = url;

  const counts = useQuery(api.ingest.counts);
  const inboxBadge = useQuery(api.ui.inboxBadge);
  const run = useQuery(api.dashboard.latestRun);
  const workspace = useQuery(api.settings.get);
  const demoGate = useQuery(api.demoAuth.gate);
  const ledger = useQuery(api.ui.transactionLedger, caseSlug || tab === "review" ? {} : "skip");
  const queueForLink = useQuery(api.ui.inboxQueue, caseSlug ? {} : "skip");
  const grantsList = useQuery(api.grants.listFull);
  const resetRun = useMutation(api.ingest.resetRunState);

  const [cmdOpen, setCmdOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [whyTxnId, setWhyTxnId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [seedLoading, setSeedLoading] = useState(false);
  const [statusToast, setStatusToast] = useState<{ message: string; undo?: () => void } | null>(null);
  // Per-viewer convenience: who you are acting as survives a reload (never shared, never trusted by the server).
  const storedActor = useSyncExternalStore(subscribeActor, readStoredActor, () => null);

  const passcodeReady = useClientPasscodeReady();
  const canWrite = passcodeReady && hasDemoWriteAccess(demoGate?.requiresPasscode ?? false);
  const adminMode = useAdminMode();
  const offline = useConvexConnection();
  const [unreachableAfterMs, setUnreachableAfterMs] = useState<number | null>(null);

  // Legacy ?tab= values (overview, inbox, report, yourdata, …) are rewritten once to the new views.
  useEffect(() => {
    if (needsRewrite) setParams({ tab, view: legacyView ?? undefined });
  }, [needsRewrite, tab, legacyView, setParams]);

  useEffect(() => {
    if (counts !== undefined) return;
    const t = setTimeout(() => setUnreachableAfterMs(Date.now()), 8000);
    return () => clearTimeout(t);
  }, [counts]);

  // Marketing deep links (?case=black-cat) resolve to a line once the ledger is in.
  const slugHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!caseSlug || slugHandled.current === caseSlug || !ledger || !queueForLink) return;
    const notAllowed = queueForLink.filter((r) => r.status === "blocked").map((r) => r.txnId);
    const resolved = resolveCaseDeepLink(caseSlug, ledger, notAllowed);
    slugHandled.current = caseSlug;
    setParams({ tab: "review", case: resolved, vendor: null, filter: null });
  }, [caseSlug, ledger, queueForLink, setParams]);

  const openCount = inboxBadge?.open ?? 0;
  useEffect(() => {
    const page = ({ packages: "Packages", package: "Package", review: "Review", data: "Data" } as Record<string, string>)[tab] ?? "";
    const prefix = openCount > 0 ? `(${openCount}) ` : "";
    const title = `${prefix}${page ? `${page} · ` : ""}Steward`;
    document.title = title;
    // Next applies the route's metadata title after client navigations; set ours again once it has.
    const t = window.setTimeout(() => { document.title = title; }, 400);
    return () => window.clearTimeout(t);
  }, [openCount, tab]);

  useEffect(() => {
    if (!statusToast) return;
    const t = setTimeout(() => setStatusToast(null), 7000);
    return () => clearTimeout(t);
  }, [statusToast]);

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

  const people = useMemo((): Person[] => {
    if (!workspace) return [];
    const map = new Map<string, Person>();
    const add = (name: string, role: Person["roles"][number]) => {
      const p = map.get(name) ?? { name, roles: [] };
      if (!p.roles.includes(role)) p.roles.push(role);
      map.set(name, p);
    };
    workspace.reviewers.forEach((n) => add(n, "reviewer"));
    workspace.preparers.forEach((n) => add(n, "preparer"));
    workspace.programApprovers.forEach((n) => add(n, "program_approver"));
    return [...map.values()];
  }, [workspace]);

  const actor =
    (storedActor && people.some((p) => p.name === storedActor) ? storedActor : null) ??
    workspace?.approverLabel ??
    people[0]?.name ??
    "";
  const setActor = useCallback((name: string) => {
    memActor = name;
    try {
      localStorage.setItem(ACTOR_KEY, name);
    } catch {
      /* storage blocked: the in-memory choice lasts until reload */
    }
    actorListeners.forEach((l) => l());
  }, []);

  const me = people.find((p) => p.name === actor);
  const ctx = useMemo((): AppCtx => {
    // The backend approver guard accepts the primary approver and the Controller for exception decisions.
    const canResolve = !!workspace && (actor === workspace.approverLabel || actor === "Controller");
    return {
      actor,
      people,
      isPreparer: !!me?.roles.includes("preparer"),
      isReviewer: !!me?.roles.includes("reviewer"),
      isProgramApprover: !!me?.roles.includes("program_approver"),
      canResolve,
      canWrite,
      passcode: getDemoPasscode(),
      toast: (message, undo) => setStatusToast({ message, undo }),
      fail: (message) => {
        setStatusToast(null);
        setInlineError(message);
      },
    };
  }, [actor, people, me, workspace, canWrite]);

  const grantTerms = useMemo(
    () => (grantsList ?? []).filter((g) => g.status === "ready").map((g) => g.terms as GrantTerms | null).filter(Boolean) as GrantTerms[],
    [grantsList],
  );

  async function loadDemo() {
    if (!canWrite) {
      setInlineError("View-only demo: add the demo key to the link to load data.");
      return;
    }
    setSeedLoading(true);
    setInlineError(null);
    try {
      const res = await fetch("/api/seed?set=v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: getDemoPasscode() }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) throw new Error(body.error ?? "Loading the sample failed");
    } catch (e) {
      setInlineError(messageFromConvexError(e));
    } finally {
      setSeedLoading(false);
    }
  }

  const paletteCommands = useMemo((): Command[] => {
    const cmds: Command[] = [
      { id: "packages", label: "Go to packages", run: () => setTab("packages") },
      { id: "review", label: "Review exceptions", run: () => setTab("review") },
      { id: "data", label: "Go to data", run: () => setTab("data") },
      { id: "help", label: "Keyboard shortcuts", run: () => setHelpOpen(true) },
    ];
    for (const p of people) {
      cmds.push({ id: `actor-${p.name}`, label: `Act as ${p.name}`, keywords: "switch user role", run: () => setActor(p.name) });
    }
    if (adminMode) {
      cmds.push(
        { id: "reload", label: "Reload sample data", run: () => void loadDemo() },
        {
          id: "reset",
          label: "Reset run state",
          run: () => {
            if (confirm("Reset Steward's decisions and every resolution? Uploaded files stay.")) {
              void resetRun({ passcode: getDemoPasscode() }).catch((e) => setInlineError(messageFromConvexError(e)));
            }
          },
        },
      );
    }
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, adminMode, setTab, setActor]);

  if (counts === undefined) {
    if (unreachableAfterMs !== null) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-paper p-8">
          <div className="max-w-md text-center">
            <h1 className="font-serif text-xl text-ink">Can&apos;t reach the data server.</h1>
            <p className="mt-3 text-base text-ink-2">Check your connection, then try again.</p>
            <Button variant="primary" className="mt-6" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return <AppLoadingShell />;
  }

  if (counts.transactions === 0 && tab !== "data") {
    return (
      <AppContext.Provider value={ctx}>
        <div className="flex min-h-screen items-center justify-center bg-paper p-6">
          <div className="max-w-[520px]">
            <p className="font-serif text-[22px] text-ink">Steward</p>
            <h1 className="mt-8 font-serif text-2xl text-ink text-balance">
              Bill the city <em className="italic text-ink-2">to the cent.</em>
            </h1>
            <p className="mt-4 text-md text-ink-2">
              Steward reads your contract, GL detail and receipts, builds each month&apos;s invoice and expenditure
              report, and shows your reviewer only the exceptions. It never signs, posts or moves money.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button variant="primary" busy={seedLoading} busyLabel="Loading the sample…" onClick={() => void loadDemo()}>
                Load the sample city contract
              </Button>
              <Button onClick={() => setTab("data")}>Use my own files</Button>
            </div>
            <p className="mt-4 text-sm text-ink-2">The sample is synthetic: a fictional nonprofit, contract and ledger.</p>
            {inlineError && (
              <p role="alert" className="mt-4 text-sm text-redpen-ink">
                {inlineError}
              </p>
            )}
          </div>
        </div>
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex min-h-screen flex-col bg-paper text-ink">
        <a
          href="#main"
          className="sr-only z-50 rounded-pill bg-ink px-4 py-2 text-sheet focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        {offline && (
          <p className="no-print border-b border-rule bg-amber-tint px-4 py-1.5 text-center text-sm text-amber-ink" role="status">
            Offline — reconnecting…
          </p>
        )}
        <TopBar
          orgDisplay={workspace?.organizationName ?? ""}
          showSyntheticBadge={counts.transactions > 0}
          isCustomData={workspace?.dataSource === "custom"}
          viewOnly={passcodeReady && !!demoGate?.requiresPasscode && !canWrite}
          runStatus={run?.status}
          runProgress={run?.progress}
          tab={tab}
          onTab={setTab}
          reviewCount={openCount}
          actor={actor}
          people={people}
          setActor={setActor}
          onOpenCommand={() => setCmdOpen(true)}
        />
        {(inlineError || (run?.status === "error" && run.errors.length > 0)) && (
          <div className="no-print mx-auto w-full max-w-[1360px] px-4 pt-3 sm:px-6" role="alert">
            <div className="flex flex-wrap items-start gap-3 rounded-sm border border-redpen/40 bg-redpen-tint px-4 py-2.5 text-sm text-redpen-ink">
              <span className="min-w-0 flex-1">
                {inlineError ?? `Steward's last run failed: ${run?.errors[0]}`}
              </span>
              {inlineError && (
                <button type="button" className="font-medium underline underline-offset-2" onClick={() => setInlineError(null)}>
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-16 pt-4 sm:px-6">
          {tab === "packages" && <PackagesView onGoData={() => setTab("data")} />}
          {tab === "package" && <PackageView url={url} grantTerms={grantTerms} />}
          {tab === "review" && (
            <ReviewView
              url={url}
              grantTerms={grantTerms}
              cmdOpen={cmdOpen}
              helpOpen={helpOpen}
              panelOpen={panelMode !== null}
              onWhy={(txnId) => {
                setWhyTxnId(txnId);
                setPanelMode("why");
              }}
              onHelp={() => setHelpOpen(true)}
            />
          )}
          {tab === "data" && <DataView url={url} grantTerms={grantTerms} onError={setInlineError} />}
        </main>

        <CommandPalette
          open={cmdOpen}
          onClose={() => setCmdOpen(false)}
          commands={paletteCommands}
          transactions={ledger ?? []}
          grantTerms={grantTerms}
          onJumpTxn={(txnId) => url.setCaseId(txnId)}
        />
        <ContextPanel
          mode={panelMode}
          onClose={() => setPanelMode(null)}
          txnId={whyTxnId}
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
    </AppContext.Provider>
  );
}
