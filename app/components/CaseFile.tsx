"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { contractClausesFromDecision } from "@/lib/clauseText";
import { stewardCodingLabel } from "@/lib/codingLabel";
import { displayVendor } from "@/lib/displayVendor";
import { getFundLabel, grantLineText } from "@/lib/fundLabels";
import { issueLabel } from "@/lib/issueLabel";
import { shouldIgnoreAppShortcut } from "@/lib/keyboardGuard";
import type { GrantTerms, RulingType } from "@/lib/types";
import { vendorKey } from "@/lib/vendorKey";
import { messageFromConvexError } from "../lib/convexError";
import { fixTypeOf } from "../lib/fixType";
import { shortDate } from "../lib/packageText";
import { shortName, useApp } from "./AppContext";
import { GlossaryTerm } from "./GlossaryTerm";
import { RedPenStrike } from "./RedPenStrike";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { fmtUsd, Money } from "./ui/Money";

type Txn = {
  txnId: string;
  date: string;
  description: string;
  amountCents: number;
  memo: string;
  vendor?: string;
  account?: string;
  department?: string;
  docRef?: string;
  enteredBy?: string;
  programApprovedBy?: string | null;
};
type Decision = {
  txnId: string;
  grantId: string | null;
  budgetLine: string | null;
  splits?: unknown;
  status: string;
  rationale: string;
  modelRationale?: string;
  checks?: { ruleId: string | null; label: string; message: string }[];
  evidence?: unknown;
  ruleHits: string[];
};
export type CaseData = {
  txn: Txn | null;
  decision: Decision | null;
  gl: { class: string | null; budgetLine: string | null; enteredBy?: string; account?: string } | null;
  entry: { id: string; lines: unknown } | null;
};

/** Red-pen strike draws once per case per session. */
const seenStrikes = new Set<string>();

export function vendorName(t: { vendor?: string; description: string }) {
  const raw = t.vendor || t.description;
  return /[a-z]/.test(raw) ? raw : displayVendor(raw);
}

export function CaseFile({
  data,
  grantTerms,
  resolved,
  onResolved,
  onRestored,
  onWhy,
  onBack,
  cmdOpen,
  helpOpen,
  panelOpen,
}: {
  data: CaseData | null | undefined;
  grantTerms: GrantTerms[];
  resolved: boolean;
  onResolved: (txnId: string) => void;
  onRestored: (txnId: string) => void;
  onWhy: (txnId: string) => void;
  onBack?: () => void;
  cmdOpen: boolean;
  helpOpen: boolean;
  panelOpen: boolean;
}) {
  if (data === undefined) return <CaseSkeleton />;
  if (!data?.txn || !data.decision) {
    return (
      <div className="flex min-h-[320px] items-center justify-center p-8 text-center text-base text-ink-2">
        Pick a line on the left to see what Steward found and what to do.
      </div>
    );
  }
  return (
    <CaseInner
      key={data.txn.txnId}
      txn={data.txn}
      decision={data.decision}
      gl={data.gl}
      entry={data.entry}
      grantTerms={grantTerms}
      resolved={resolved}
      onResolved={onResolved}
      onRestored={onRestored}
      onWhy={onWhy}
      onBack={onBack}
      cmdOpen={cmdOpen}
      helpOpen={helpOpen}
      panelOpen={panelOpen}
    />
  );
}

function CaseInner({
  txn,
  decision,
  gl,
  entry,
  grantTerms,
  resolved,
  onResolved,
  onRestored,
  onWhy,
  onBack,
  cmdOpen,
  helpOpen,
  panelOpen,
}: {
  txn: Txn;
  decision: Decision;
  gl: CaseData["gl"];
  entry: CaseData["entry"];
  grantTerms: GrantTerms[];
  resolved: boolean;
  onResolved: (txnId: string) => void;
  onRestored: (txnId: string) => void;
  onWhy: (txnId: string) => void;
  onBack?: () => void;
  cmdOpen: boolean;
  helpOpen: boolean;
  panelOpen: boolean;
}) {
  const app = useApp();
  const receipts = useQuery(api.ui.caseReceipts, { txnId: txn.txnId });
  const approve = useMutation(api.approvals.approveEntry);
  const reject = useMutation(api.approvals.rejectEntry);
  const acknowledge = useMutation(api.approvals.acknowledgeDecision);
  const overrideDecision = useMutation(api.approvals.overrideDecision);
  const undoApprove = useMutation(api.approvals.undoApproveEntry);
  const undoResolution = useMutation(api.approvals.undoInboxResolution);
  const linkReceipt = useMutation(api.receipts.link);
  const uploadUrl = useMutation(api.receipts.generateUploadUrl);
  const registerReceipt = useMutation(api.receipts.register);

  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<"txn" | "vendor">("txn");
  const [approvalRef, setApprovalRef] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ruleId = decision.ruleHits[0] ?? null;
  const fix = fixTypeOf(ruleId, decision.status);
  const blocked = decision.status === "blocked";
  const clean = decision.status === "auto";
  const lineName = (gid: string | null, code: string | null) =>
    grantTerms.find((g) => g.grantId === gid)?.budgetLines.find((l) => l.code === code)?.name;
  const label = (gid: string | null, line: string | null, splits?: unknown) =>
    stewardCodingLabel({
      amountCents: txn.amountCents,
      grantId: gid,
      budgetLine: line,
      splits: splits as { grantId: string | null; budgetLine: string | null; amount: number }[] | undefined,
      lineName,
      grants: grantTerms,
      description: txn.description,
      memo: txn.memo,
    });
  const booksLabel = gl?.class !== undefined && gl ? label(gl.class, gl.budgetLine) : null;
  const stewardLabel = label(decision.grantId, decision.budgetLine, decision.splits);
  const disagrees = !!booksLabel && booksLabel !== stewardLabel;
  const strikeKey = txn.txnId;
  const strikeAnimate = !seenStrikes.has(strikeKey);
  useEffect(() => {
    seenStrikes.add(strikeKey);
  }, [strikeKey]);

  const evidence = (decision.evidence ?? []) as { source: string; ref: string; note: string }[];
  const clauses = contractClausesFromDecision(grantTerms, evidence);
  const found = issueLabel(ruleId, decision.status);
  const why = (decision.modelRationale ?? decision.rationale ?? "").trim();
  const checks = decision.checks ?? [];
  const matched = receipts?.find((r) => r.matched);
  const candidates = (receipts ?? []).filter((r) => !r.matched);
  const fundTitle = getFundLabel(decision.grantId, grantTerms).title;
  const movesFund = (gl?.class ?? null) !== decision.grantId;

  const entryLines = (entry?.lines ?? []) as { account: string; class: string | null; budgetLine: string | null; debit: number; credit: number }[];

  // One primary action per case, worded as what it does.
  let primaryLabel: string;
  let todo: string;
  const debits = entryLines.filter((l) => l.debit > 0);
  const moved = debits.reduce((a, l) => a + l.debit, 0) || Math.abs(txn.amountCents);
  const partial = moved < Math.abs(txn.amountCents);
  const moveLabel = partial ? `Move ${fmtUsd(moved)} off the grant` : "Move to general funds";
  if (fix === "approval") {
    // Can't be billed until the funder approves. Way out: record the approval (a human resolution that keeps the
    // bookkeeper's coding), or approve Steward's entry that moves the blocked portion off the grant.
    primaryLabel = "Record funder approval";
    todo = blocked
      ? `This can't be billed until the funder approves it in writing. Record the approval reference to bill it as booked${entry ? `, or move ${partial ? `the ${fmtUsd(moved)} over the limit` : "it"} to general funds` : ""}.`
      : "The contract needs the funder's written OK for this. Record the approval reference, or override with a note.";
  } else if (entry) {
    primaryLabel = blocked && !decision.grantId ? moveLabel : "Approve the correction";
    const dest = debits.length ? [...new Set(debits.map((l) => grantLineText(l.class, l.budgetLine, grantTerms)))].join(" and ") : stewardLabel;
    todo = `Steward drafted a journal entry that moves ${fmtUsd(moved)} to ${dest}. Approve it, or override with a note to keep the bookkeeper's coding.`;
  } else if (fix === "not_allowed") {
    primaryLabel = decision.grantId ? `Move to ${fundTitle}` : "Move to general funds";
    todo = `This can't be billed to the grant. Move it to ${decision.grantId ? fundTitle : "general funds"}, or override with a documented reason.`;
  } else if (fix === "receipt") {
    primaryLabel =
      candidates.length === 1
        ? `Link ${candidates[0]!.fileName}`
        : matched
          ? ruleId === "R-NEEDS-DOCS"
            ? "Confirm it's documented"
            : "Accept the receipt on file"
          : "Attach receipt";
    todo =
      candidates.length > 1
        ? "Several receipts could belong to this line. Link the right one, or attach a new file."
        : candidates.length === 1
          ? "One receipt looks like it belongs here. Link it, or attach a different file."
          : matched
            ? ruleId === "R-NEEDS-DOCS"
              ? "A receipt is on file, but Steward wants the support behind it (who received what). Confirm it's documented, or override with a note."
              : "A receipt is on file; confirm it covers this charge."
            : `Charges at or above the receipt threshold need a receipt before the funder will pay.`;
  } else if (fix === "payroll") {
    primaryLabel = "Accept Steward's split";
    todo = "Pay charged to the grant doesn't match the time sheet. Accept Steward's split, or override with a note.";
  } else if (fix === "amount") {
    primaryLabel = ruleId === "R-DUPLICATE" ? "Confirm it's a duplicate" : "Agree with Steward";
    todo = "The amounts don't line up across the books, bank or receipt. Agree with Steward's reading, or override with a note.";
  } else {
    primaryLabel = disagrees || movesFund ? `Move to ${decision.grantId ? fundTitle : "general funds"}` : "Keep this coding";
    todo = disagrees
      ? `Steward would code this to ${stewardLabel} instead of the bookkeeper's ${booksLabel}.`
      : "Steward isn't sure which fund this belongs to. Confirm its coding, or override with a note.";
  }

  const blockedReason = !app.canWrite
    ? "View-only demo: decisions need the demo key in the link."
    : !app.canResolve
      ? `Exception decisions are made by a reviewer. Switch “Acting as” to ${app.people.find((p) => p.roles.includes("reviewer"))?.name ?? "a reviewer"}.`
      : null;

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(messageFromConvexError(e));
    } finally {
      setBusy(null);
    }
  }

  const precedentFor = (): RulingType =>
    ruleId === "R-PRIOR-APPROVAL" ? "prior_approval_granted" : ruleId === "R-DUPLICATE" ? "not_duplicate" : blocked ? "disallow" : "allow";

  async function ack(noteText: string, rulingType?: RulingType) {
    await acknowledge({
      txnId: txn.txnId,
      by: app.actor,
      note: noteText,
      passcode: app.passcode,
      precedentScope: "txn",
      rulingType,
      grantScope: decision.grantId ?? "ALL",
    });
    onResolved(txn.txnId);
    app.toast(`${vendorName(txn)} resolved by ${shortName(app.actor)}`, () => {
      void undoResolution({ txnId: txn.txnId, by: app.actor, passcode: app.passcode })
        .then(() => onRestored(txn.txnId))
        .catch((e) => app.fail(messageFromConvexError(e)));
    });
  }

  async function attachFile(file: File) {
    const url = await uploadUrl({ passcode: app.passcode });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    if (!res.ok) throw new Error(`Upload failed: ${file.name}`);
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    const receiptId = await registerReceipt({ storageId, fileName: file.name, contentType: file.type || undefined, passcode: app.passcode });
    await linkReceipt({ receiptId, txnId: txn.txnId, by: app.actor, note: `Attached in review: ${file.name}`, passcode: app.passcode });
    await ack(`Receipt attached: ${file.name}`, "allow");
  }

  function approveEntryNow(name: string) {
    if (!entry) return;
    void run(name, async () => {
      await approve({ entryId: entry.id, by: app.actor, note: "Approved in review", passcode: app.passcode });
      onResolved(txn.txnId);
      app.toast(`Correction approved by ${shortName(app.actor)}`, () => {
        void undoApprove({ entryId: entry.id, by: app.actor, passcode: app.passcode })
          .then(() => onRestored(txn.txnId))
          .catch((e) => app.fail(messageFromConvexError(e)));
      });
    });
  }

  function onPrimary() {
    if (blockedReason || busy) return;
    if (fix === "approval") {
      if (!approvalRef.trim()) {
        document.getElementById(`approval-ref-${txn.txnId}`)?.focus();
        setError("Add the funder's approval reference first.");
        return;
      }
      // The approval keeps the bookkeeper's coding (an override with the approval as its note) and is
      // recorded as a ruling for this line, so the next run no longer flags it.
      void run("primary", async () => {
        await overrideDecision({ txnId: txn.txnId, by: app.actor, note: `Funder approval on file: ${approvalRef.trim()}`, passcode: app.passcode,
          precedentScope: "txn", rulingType: "prior_approval_granted", grantScope: gl?.class ?? decision.grantId ?? "ALL" });
        onResolved(txn.txnId);
        app.toast(`Funder approval recorded by ${shortName(app.actor)}`, () => {
          void undoResolution({ txnId: txn.txnId, by: app.actor, passcode: app.passcode })
            .then(() => onRestored(txn.txnId))
            .catch((e) => app.fail(messageFromConvexError(e)));
        });
      });
      return;
    }
    if (entry) {
      approveEntryNow("primary");
      return;
    }
    if (fix === "receipt") {
      if (candidates.length === 1) {
        const r = candidates[0]!;
        void run("primary", async () => {
          await linkReceipt({ receiptId: r._id as Id<"receipts">, txnId: txn.txnId, by: app.actor, passcode: app.passcode });
          await ack(`Receipt linked: ${r.fileName}`, "allow");
        });
      } else if (matched) {
        void run("primary", () => ack(`Receipt on file covers this charge: ${matched.fileName}`, "allow"));
      } else {
        fileRef.current?.click();
      }
      return;
    }
    void run("primary", () => ack(`${primaryLabel}. ${found}.`, precedentFor()));
  }

  function onOverrideSubmit() {
    if (!note.trim() || blockedReason) return;
    void run("override", async () => {
      if (entry) {
        await reject({ entryId: entry.id, by: app.actor, note: note.trim(), passcode: app.passcode, precedentScope: scope, rulingType: "allow", grantScope: decision.grantId ?? "ALL" });
      } else {
        await overrideDecision({ txnId: txn.txnId, by: app.actor, note: note.trim(), passcode: app.passcode, precedentScope: scope, rulingType: "allow", grantScope: decision.grantId ?? "ALL" });
      }
      onResolved(txn.txnId);
      app.toast(`Override recorded by ${shortName(app.actor)} — the bookkeeper's coding stands`, entry ? undefined : () => {
        void undoResolution({ txnId: txn.txnId, by: app.actor, passcode: app.passcode })
          .then(() => onRestored(txn.txnId))
          .catch((e) => app.fail(messageFromConvexError(e)));
      });
    });
  }

  // Keyboard: A = primary, O = override, E = evidence.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (shouldIgnoreAppShortcut(e, { cmdOpen, helpOpen, panelOpen, popoverOpen: overrideOpen })) return;
      if (resolved || clean) return;
      const k = e.key.toLowerCase();
      if (k === "a") {
        e.preventDefault();
        onPrimary();
      } else if (k === "o") {
        e.preventDefault();
        setOverrideOpen(true);
      } else if (k === "e") {
        e.preventDefault();
        setEvidenceOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const statusTone = clean ? "green" : blocked ? "red" : "amber";
  const statusText = resolved ? "Resolved" : clean ? "Clean" : blocked ? (fix === "approval" ? "Can't bill yet" : "Not allowed") : "Needs you";

  return (
    <article className="flex min-h-full flex-col" aria-labelledby={`case-${txn.txnId}`}>
      {onBack && (
        <div className="sticky top-0 z-10 border-b border-rule bg-sheet px-4 py-1 lg:hidden">
          <button type="button" onClick={onBack} className="min-h-11 text-base text-ink-2 hover:text-ink">
            ← Back to the list
          </button>
        </div>
      )}
      <header className="grid gap-x-6 gap-y-3 px-5 pb-5 pt-6 sm:grid-cols-[1fr_auto] sm:px-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={resolved ? "neutral" : statusTone}>{statusText}</Badge>
            <span className="text-sm text-ink-2">
              {shortDate(txn.date, true)} · {txn.txnId}
              {txn.docRef ? ` · ${txn.docRef}` : ""}
            </span>
          </div>
          <h2 id={`case-${txn.txnId}`} className="mt-3 break-words text-lg font-medium text-ink">
            {vendorName(txn)}
          </h2>
          {txn.memo && <p className="mt-1 text-sm text-ink-2">“{txn.memo}”</p>}
        </div>
        <Money cents={Math.abs(txn.amountCents)} focal className="text-2xl font-medium tracking-[-0.02em] sm:text-right" />
      </header>

      {/* What we found */}
      <section className="border-t border-rule px-5 py-5 sm:px-8" aria-labelledby={`found-${txn.txnId}`}>
        <h3 id={`found-${txn.txnId}`} className="text-xs font-medium text-ink-2">
          What we found
        </h3>
        <p className={`mt-2 font-serif text-lg ${blocked ? "text-redpen-ink" : "text-ink"}`}>{clean ? "Nothing wrong with this line." : found}</p>
        {why && !clean && <p className="mt-2 max-w-[68ch] text-base text-ink">{why}</p>}
        {checks.length > 0 && !clean && (
          <ul className="mt-2 max-w-[68ch] space-y-1 text-sm text-ink-2">
            {checks.map((c, i) => (
              <li key={`${c.ruleId ?? "c"}-${i}`}>{c.message}</li>
            ))}
          </ul>
        )}
        {booksLabel && (
          <div className="mt-4 grid gap-1 text-base sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <span className="text-ink-2">Books say</span>
            <span className="min-w-0">
              {disagrees ? <RedPenStrike text={booksLabel} animate={strikeAnimate} /> : <span className="text-ink">{booksLabel}</span>}
            </span>
            {disagrees && (
              <>
                <span className="text-ink-2">Steward says</span>
                <span className="font-medium text-green-ink">{stewardLabel}</span>
              </>
            )}
          </div>
        )}
      </section>

      {/* Why: evidence side by side, collapsed by default */}
      <section className="border-t border-rule px-5 py-4 sm:px-8">
        <button
          type="button"
          aria-expanded={evidenceOpen}
          onClick={() => setEvidenceOpen((o) => !o)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-base text-ink"
        >
          <span>
            Why <span className="text-ink-2">· {[clauses.length ? "contract" : null, receipts?.length ? "receipt" : null, "ledger"].filter(Boolean).join(", ")}</span>
          </span>
          <span className="flex items-center gap-2 text-sm text-ink-2">
            <kbd className="hidden rounded-[4px] border border-rule px-1.5 text-2xs sm:inline">E</kbd>
            <span aria-hidden className={`transition-transform duration-150 ${evidenceOpen ? "rotate-90" : ""}`}>›</span>
          </span>
        </button>
        {evidenceOpen && (
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-2">Contract</p>
              {clauses.length ? (
                clauses.map((c, i) => (
                  <blockquote key={`${c.ref}-${i}`} className="mt-2">
                    <p className="font-serif text-md leading-snug text-ink">“{c.rule}”</p>
                    <footer className="mt-1 text-xs text-ink-2">{c.ref}</footer>
                  </blockquote>
                ))
              ) : (
                <p className="mt-2 text-sm text-ink-2">No clause cited for this line.</p>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-2">Receipt</p>
              {receipts === undefined ? (
                <div className="mt-2 h-32 animate-pulse rounded-sm bg-paper-2" />
              ) : receipts.length === 0 ? (
                <p className="mt-2 text-sm text-ink-2">No receipt on file.</p>
              ) : (
                receipts.map((r) => <ReceiptPreview key={r._id} r={r} />)
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-2">Ledger line</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-2">Coded to</dt>
                <dd className="min-w-0 break-words text-ink">{gl ? grantLineText(gl.class, gl.budgetLine, grantTerms) : "—"}</dd>
                {txn.account && (
                  <>
                    <dt className="text-ink-2">Account</dt>
                    <dd className="min-w-0 break-words">{txn.account}</dd>
                  </>
                )}
                {txn.department && (
                  <>
                    <dt className="text-ink-2">Department</dt>
                    <dd>{txn.department}</dd>
                  </>
                )}
                <dt className="text-ink-2">Entered by</dt>
                <dd>{(gl?.enteredBy ?? txn.enteredBy ?? "—").replace(/^bookkeeper:/, "")}</dd>
                <dt className="text-ink-2">Amount</dt>
                <dd className="tabular">{fmtUsd(txn.amountCents)}</dd>
              </dl>
            </div>
          </div>
        )}
      </section>

      {/* What to do */}
      {!clean && !resolved && (
        <section className="border-t border-rule bg-paper/50 px-5 py-5 sm:px-8" aria-labelledby={`todo-${txn.txnId}`}>
          <h3 id={`todo-${txn.txnId}`} className="text-xs font-medium text-ink-2">
            What to do
          </h3>
          <p className="mt-2 max-w-[68ch] text-base text-ink">
            {todo}
            {fix === "not_allowed" && (
              <>
                {" "}
                <GlossaryTerm term="restricted funds">Why?</GlossaryTerm>
              </>
            )}
          </p>

          {entry && entryLines.length > 0 && (
            <table className="mt-3 w-full max-w-[560px] border-collapse text-sm">
              <caption className="sr-only">Proposed journal entry</caption>
              <thead>
                <tr className="text-left text-xs text-ink-2">
                  <th scope="col" className="border-b border-rule py-1.5 font-medium">
                    <GlossaryTerm term="journal entry">Journal entry</GlossaryTerm>
                  </th>
                  <th scope="col" className="border-b border-rule py-1.5 text-right font-medium">Debit</th>
                  <th scope="col" className="border-b border-rule py-1.5 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {entryLines.map((l, i) => (
                  <tr key={i}>
                    <td className="border-b border-rule py-1.5 pr-3">{grantLineText(l.class, l.budgetLine, grantTerms)}</td>
                    <td className="tabular border-b border-rule py-1.5 text-right">{l.debit ? fmtUsd(l.debit) : ""}</td>
                    <td className="tabular border-b border-rule py-1.5 text-right">{l.credit ? fmtUsd(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {fix === "receipt" && candidates.length > 1 && !entry && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {candidates.map((r) => (
                <li key={r._id}>
                  <Button
                    size="sm"
                    disabled={!!blockedReason}
                    busy={busy === `link-${r._id}`}
                    onClick={() =>
                      void run(`link-${r._id}`, async () => {
                        await linkReceipt({ receiptId: r._id as Id<"receipts">, txnId: txn.txnId, by: app.actor, passcode: app.passcode });
                        await ack(`Receipt linked: ${r.fileName}`, "allow");
                      })
                    }
                  >
                    Link {r.fileName}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {fix === "approval" && (
            <label className="mt-3 block max-w-[420px] text-sm text-ink-2">
              Funder approval reference (email, letter, date)
              <input
                id={`approval-ref-${txn.txnId}`}
                value={approvalRef}
                onChange={(e) => setApprovalRef(e.target.value)}
                placeholder="e.g. Program officer email, Sep 3"
                className="mt-1 block min-h-11 w-full rounded-sm border border-rule-strong bg-sheet px-3 text-base text-ink placeholder:text-ink-2 sm:min-h-10"
              />
            </label>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void run("primary", () => attachFile(f));
            }}
          />

          {!overrideOpen ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={!!blockedReason} busy={busy === "primary"} onClick={onPrimary}>
                {primaryLabel}
                <kbd className="ml-1 hidden rounded-[4px] border border-sheet/30 px-1 text-2xs font-normal sm:inline">A</kbd>
              </Button>
              {fix === "approval" && entry && (
                <Button disabled={!!blockedReason} busy={busy === "move"} onClick={() => approveEntryNow("move")}>
                  {moveLabel}
                </Button>
              )}
              <Button variant="ghost" disabled={!!blockedReason} onClick={() => setOverrideOpen(true)}>
                Override with a note
                <kbd className="ml-1 hidden rounded-[4px] border border-rule px-1 text-2xs font-normal sm:inline">O</kbd>
              </Button>
              <Button variant="ghost" className="sm:ml-auto" onClick={() => onWhy(txn.txnId)}>
                Ask Steward why
              </Button>
            </div>
          ) : (
            <form
              className="mt-4 max-w-[560px] space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                onOverrideSubmit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOverrideOpen(false);
              }}
            >
              <label className="block text-sm text-ink-2">
                Why the bookkeeper&apos;s coding should stand (kept in the audit trail)
                <textarea
                  autoFocus
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 block w-full rounded-sm border border-rule-strong bg-sheet p-3 text-base text-ink"
                />
              </label>
              <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <legend className="sr-only">Apply to</legend>
                <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
                  <input type="radio" checked={scope === "txn"} onChange={() => setScope("txn")} /> This line only
                </label>
                <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
                  <input type="radio" checked={scope === "vendor"} onChange={() => setScope("vendor")} /> Every charge from{" "}
                  {vendorKey(txn.description) || "this vendor"}
                </label>
              </fieldset>
              <div className="flex gap-3">
                <Button type="submit" variant="primary" disabled={!note.trim()} busy={busy === "override"}>
                  Record override
                </Button>
                <Button variant="ghost" onClick={() => setOverrideOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {(blockedReason || error) && (
            <p role={error ? "alert" : undefined} className={`mt-3 text-sm ${error ? "text-redpen-ink" : "text-ink-2"}`}>
              {error ?? blockedReason}
            </p>
          )}
          <p className="mt-4 text-xs text-ink-2">
            Steward flagged this{ruleId ? ` (${ruleId})` : ""}. Your decision is logged under {shortName(app.actor) || "your name"}.
          </p>
        </section>
      )}
      {resolved && (
        <p className="border-t border-rule px-5 py-5 text-base text-ink-2 sm:px-8">A person already decided this line.</p>
      )}
    </article>
  );
}

function ReceiptPreview({
  r,
}: {
  r: { _id: string; fileName: string; contentType: string | null; url: string | null; matched: boolean; coversGroup?: boolean; extracted: { vendor: string | null; totalCents: number | null; date: string | null } | null };
}) {
  const isPdf = r.contentType === "application/pdf" || r.fileName.toLowerCase().endsWith(".pdf");
  return (
    <figure className="mt-2">
      {r.url ? (
        isPdf ? (
          <object data={`${r.url}#toolbar=0&view=FitH`} type="application/pdf" className="h-56 w-full rounded-sm border border-rule bg-paper" aria-label={r.fileName}>
            <a href={r.url} target="_blank" rel="noreferrer" className="block p-3 text-sm underline">
              Open {r.fileName}
            </a>
          </object>
        ) : (
          // Receipt images come from Convex storage; next/image would need a remote pattern for little gain here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.url} alt={`Receipt ${r.fileName}`} className="max-h-56 w-full rounded-sm border border-rule bg-paper object-contain" />
        )
      ) : null}
      <figcaption className="mt-1 flex flex-wrap justify-between gap-x-2 text-xs text-ink-2">
        <span className="min-w-0 truncate">
          {r.coversGroup ? "Covers this split purchase · " : r.matched ? "Matched · " : "Possible match · "}
          {r.fileName}
        </span>
        {r.extracted?.totalCents != null && <span className="tabular">{fmtUsd(r.extracted.totalCents)}</span>}
      </figcaption>
      {r.url && (
        <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-ink underline underline-offset-2">
          Open full size
        </a>
      )}
    </figure>
  );
}

function CaseSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-8" aria-busy aria-label="Loading case">
      <div className="h-5 w-40 rounded-sm bg-paper-2" />
      <div className="h-7 w-64 rounded-sm bg-paper-2" />
      <div className="h-24 rounded-sm bg-paper-2" />
      <div className="h-40 rounded-sm bg-paper-2" />
    </div>
  );
}
