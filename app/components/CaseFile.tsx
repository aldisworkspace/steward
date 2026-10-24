"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { messageFromConvexError } from "../lib/convexError";
import { contractClausesFromDecision } from "@/lib/clauseText";
import type { RulingType } from "@/lib/types";
import { vendorKey } from "@/lib/vendorKey";
import { stewardCodingLabel } from "@/lib/codingLabel";
import type { GrantTerms } from "@/lib/types";
import { fmtSentenceAmount, fmtTableAmount } from "../format";
import { caseNarrative } from "@/lib/caseNarrative";
import { EvidenceChip } from "./EvidenceChip";
import { RedPenStrike } from "./RedPenStrike";
import { RubberStamp } from "./RubberStamp";
import { StatusPill } from "./StatusPill";
import { FundLabelDisplay, BudgetLineDisplay } from "./FundLabelDisplay";
import { GlossaryTerm } from "./GlossaryTerm";
import { getFundLabel } from "@/lib/fundLabels";
import { shouldIgnoreAppShortcut } from "@/lib/keyboardGuard";

type CaseData = {
  txn: { txnId: string; date: string; description: string; amountCents: number; memo: string } | null;
  decision: {
    txnId: string;
    grantId: string | null;
    budgetLine: string | null;
    splits?: unknown;
    status: string;
    rationale: string;
    modelRationale?: string;
    checks?: { ruleId: string | null; label: string; message: string; tick: string }[];
    evidence?: unknown;
    ruleHits: string[];
  } | null;
  gl: { class: string | null; budgetLine: string | null } | null;
  entry: { id: string; lines: unknown } | null;
  grantTerms: { fileName: string; terms: unknown }[];
};

type CaseDataLoaded = Omit<CaseData, "txn" | "decision"> & {
  txn: NonNullable<CaseData["txn"]>;
  decision: NonNullable<CaseData["decision"]>;
};

/** Red-pen strike animates once per case across remounts. */
const seenStrikeKeys = new Set<string>();

type CaseFileProps = {
  data: CaseData | null | undefined;
  actingAsSteward: boolean;
  actorLabel: string;
  passcode?: string;
  canWrite: boolean;
  onStatusLine: (m: string | null) => void;
  onWhy: () => void;
  onResolved?: () => void;
  onActionDone?: (info: { kind: "approve"; entryId: string } | { kind: "ack" | "reject"; txnId: string }) => void;
  spentByLine?: Record<string, number>;
  strikeKey: string;
  cmdOpen?: boolean;
  helpOpen?: boolean;
  panelOpen?: boolean;
};

export function CaseFile(props: CaseFileProps) {
  if (!props.data?.txn || !props.data.decision) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[15px] text-ink-2">
        Select an exception from the queue.
      </div>
    );
  }
  const data: CaseDataLoaded = {
    ...props.data,
    txn: props.data.txn,
    decision: props.data.decision,
  };
  return <CaseFileInner key={data.txn.txnId} {...props} data={data} />;
}

function grantTermsList(rows: CaseData["grantTerms"]): GrantTerms[] {
  return rows.map((g) => g.terms as GrantTerms).filter(Boolean);
}

function lineName(grantTerms: CaseData["grantTerms"], grantId: string | null, code: string | null) {
  if (!grantId || !code) return undefined;
  for (const g of grantTerms) {
    const t = g.terms as { grantId?: string; budgetLines?: { code: string; name: string }[] } | null;
    if (t?.grantId === grantId) return t.budgetLines?.find((l) => l.code === code)?.name;
  }
  return undefined;
}

function CaseFileInner({
  data,
  actingAsSteward,
  actorLabel,
  passcode,
  canWrite,
  onStatusLine,
  onWhy,
  onResolved,
  onActionDone,
  spentByLine = {},
  strikeKey,
  cmdOpen = false,
  helpOpen = false,
  panelOpen = false,
}: CaseFileProps & { data: CaseDataLoaded }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const approve = useMutation(api.approvals.approveEntry);
  const reject = useMutation(api.approvals.rejectEntry);
  const acknowledge = useMutation(api.approvals.acknowledgeDecision);
  const overrideDecision = useMutation(api.approvals.overrideDecision);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [ackOpen, setAckOpen] = useState(false);
  const [ackNote, setAckNote] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [precedentScope, setPrecedentScope] = useState<"txn" | "vendor">("txn");
  const [rulingType, setRulingType] = useState<RulingType>("allow");
  const [entryStamp, setEntryStamp] = useState<"approved" | "returned" | null>(null);
  const [stampAnimate, setStampAnimate] = useState(false);
  const stampDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const stampBy = actorLabel.replace(/\s*\(.*\)$/, "");

  useEffect(() => {
    setStampAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  function defaultRuling(ruleId: string | null | undefined): RulingType {
    if (ruleId === "R-PRIOR-APPROVAL") return "prior_approval_granted";
    if (ruleId === "R-DUPLICATE") return "not_duplicate";
    if (ruleId?.startsWith("R-UNALLOWABLE")) return "disallow";
    return "allow";
  }

  useEffect(() => {
    onStatusLine(null);
  }, [data.txn.txnId, onStatusLine]);

  const { txn, decision, gl, entry, grantTerms } = data;
  const grantScope = decision.grantId ?? "ALL";
  const strikeAnimate = !seenStrikeKeys.has(strikeKey);
  useEffect(() => {
    seenStrikeKeys.add(strikeKey);
  }, [strikeKey]);
  const vendorLabel = vendorKey(txn.description);
  const terms = grantTermsList(grantTerms);
  const ln = (gid: string | null, code: string | null) => lineName(grantTerms, gid, code);

  const bkLabel = gl?.class
    ? stewardCodingLabel({
        amountCents: txn.amountCents,
        grantId: gl.class,
        budgetLine: gl.budgetLine,
        lineName: ln,
        grants: terms,
        description: txn.description,
        memo: txn.memo,
      })
    : null;

  const stewardLabel = stewardCodingLabel({
    amountCents: txn.amountCents,
    grantId: decision.grantId,
    budgetLine: decision.budgetLine,
    splits: decision.splits as { grantId: string | null; budgetLine: string | null; amount: number }[] | undefined,
    lineName: ln,
    grants: terms,
    description: txn.description,
    memo: txn.memo,
  });

  const evidence = (decision.evidence ?? []) as { source: string; ref: string; note: string }[];
  const clauses = contractClausesFromDecision(terms, evidence);

  const lines = (entry?.lines ?? []) as {
    account: string;
    class: string | null;
    budgetLine: string | null;
    debit: number;
    credit: number;
  }[];
  const dr = lines.reduce((a, l) => a + l.debit, 0);
  const cr = lines.reduce((a, l) => a + l.credit, 0);
  const balanced = dr === cr && lines.length > 0;

  async function onApprove() {
    if (!canWrite) return;
    setActionError(null);
    if (entry) {
      onResolved?.();
      onActionDone?.({ kind: "approve", entryId: entry.id });
      try {
        await approve({
          entryId: entry.id,
          by: actorLabel,
          note: "Approved in inbox review",
          passcode,
        });
        setEntryStamp("approved");
        onStatusLine("Entry approved");
      } catch (e) {
        const msg = messageFromConvexError(e);
        setActionError(msg);
        onStatusLine(msg);
      }
      return;
    }
    if (!ackNote.trim() && !ackOpen) {
      setAckOpen(true);
      return;
    }
    if (!ackNote.trim()) return;
    onResolved?.();
    onActionDone?.({ kind: "ack", txnId: txn.txnId });
    try {
      await acknowledge({
        txnId: txn.txnId,
        by: actorLabel,
        note: ackNote.trim(),
        passcode,
        precedentScope,
        rulingType,
        grantScope,
      });
      setAckOpen(false);
      setAckNote("");
      onStatusLine("Decision acknowledged");
    } catch (e) {
      const msg = messageFromConvexError(e);
      setActionError(msg);
      onStatusLine(msg);
    }
  }

  async function onRejectSubmit() {
    if (!canWrite || !rejectNote.trim()) return;
    setActionError(null);
    if (entry) {
      try {
        await reject({
          entryId: entry.id,
          by: actorLabel,
          note: rejectNote.trim(),
          passcode,
          precedentScope,
          rulingType,
          grantScope,
        });
        setRejectOpen(false);
        setRejectNote("");
        setEntryStamp("returned");
        onStatusLine("Entry rejected");
        onResolved?.();
      } catch (e) {
        const msg = messageFromConvexError(e);
        setActionError(msg);
        onStatusLine(msg);
      }
      return;
    }
    try {
      await overrideDecision({
        txnId: txn.txnId,
        by: actorLabel,
        note: rejectNote.trim(),
        passcode,
        precedentScope,
        rulingType,
        grantScope,
      });
      setRejectOpen(false);
      setRejectNote("");
      onStatusLine("Override recorded");
    } catch (e) {
      const msg = messageFromConvexError(e);
      setActionError(msg);
      onStatusLine(msg);
    }
  }

  async function onOverrideSubmit() {
    if (!canWrite || !overrideNote.trim()) return;
    setActionError(null);
    try {
      await overrideDecision({
        txnId: txn.txnId,
        by: actorLabel,
        note: overrideNote.trim(),
        passcode,
        precedentScope,
        rulingType,
        grantScope,
      });
      setOverrideOpen(false);
      setOverrideNote("");
      onStatusLine("Override recorded");
    } catch (e) {
      const msg = messageFromConvexError(e);
      setActionError(msg);
      onStatusLine(msg);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const popoverOpen = rejectOpen || ackOpen || overrideOpen;
      if (
        shouldIgnoreAppShortcut(e, {
          cmdOpen,
          panelOpen,
          helpOpen,
          popoverOpen,
        })
      ) {
        return;
      }
      if (!canWrite) return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void onApprove();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (entry) setRejectOpen(true);
        else setOverrideOpen(true);
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setEvidenceOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canWrite, rejectOpen, ackOpen, overrideOpen, entry, cmdOpen, helpOpen, panelOpen]);

  const bankEv = evidence.find((e) => e.source === "bank");
  const glEv = evidence.find((e) => e.source === "gl");
  const timeEv = evidence.find((e) => e.source === "time_record");
  const whyText = decision.modelRationale ?? decision.rationale;
  const checks = decision.checks ?? [];
  const narrative = caseNarrative({
    bankNote: bankEv?.note,
    glNote: glEv?.note,
    bkLabel,
    stewardLabel,
    status: decision.status,
    actionHint: entry
      ? "Approve or reject the proposed journal entry."
      : "Acknowledge Steward's call or override with a note.",
  });
  const forbidReason = actingAsSteward
    ? "Switch acting user to an approver to take action."
    : !canWrite
      ? "View-only demo — add ?key= to the URL for write access."
      : null;

  const budgetImpacts = lines
    .filter((l) => l.class && l.budgetLine && (l.debit || l.credit))
    .map((l) => {
      const key = `${l.class}:${l.budgetLine}`;
      const before = spentByLine[key] ?? 0;
      const delta = l.debit - l.credit;
      const after = before + delta;
      const grant = terms.find((g) => g.grantId === l.class);
      const bl = grant?.budgetLines.find((b) => b.code === l.budgetLine);
      const cap = bl ? bl.amount * 100 : 0;
      const fund = getFundLabel(l.class, terms);
      return {
        key,
        label: `${fund.title} · ${bl?.name ?? l.budgetLine}`,
        meta: l.budgetLine,
        before,
        after,
        cap,
      };
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5 pb-28">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
          <div>
            <p className="text-[14px] text-ink-2">
              {txn.description} · {txn.date}
            </p>
            <div className="mt-2">
              <StatusPill status={decision.status} />
            </div>
          </div>
          <p className="font-display tabular text-[40px] font-bold leading-[1.1] text-ink">
            {fmtSentenceAmount(txn.amountCents)}
          </p>
        </div>

        <div className="mt-6 max-w-[75ch] space-y-2 text-[14px] text-ink">
          <p>
            <span className="text-ink-2">What happened: </span>
            {narrative.happened}
          </p>
          <p>
            <span className="text-ink-2">What Steward did: </span>
            {narrative.stewardDid}
          </p>
          <p>
            <span className="text-ink-2">What you need to do: </span>
            {decision.status === "blocked" ? (
              <>
                Confirm moving this off <GlossaryTerm term="restricted funds">grant funds</GlossaryTerm> to{" "}
                <GlossaryTerm term="general funds">general funds</GlossaryTerm>, or override with a documented
                reason.
              </>
            ) : entry ? (
              <>
                Approve or reject the proposed <GlossaryTerm term="journal entry">journal entry</GlossaryTerm>.
              </>
            ) : (
              narrative.youNeed
            )}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          {bkLabel ? (
            <RedPenStrike text={bkLabel} className="text-[14px]" animate={strikeAnimate} />
          ) : (
            <span className="text-[14px] text-ink-2">Not yet coded</span>
          )}
          <span className="text-[17px] font-semibold text-money">{stewardLabel}</span>
        </div>

        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink-2">Evidence</span>
            {bankEv && (
              <button
                type="button"
                className="rounded-full border border-navy/30 bg-navy px-2 py-1 text-[12px] text-white"
                onClick={() => setEvidenceOpen(true)}
                title={bankEv.note}
              >
                Bank
              </button>
            )}
            {glEv && (
              <button
                type="button"
                className="rounded-full border border-slate/30 bg-slate px-2 py-1 text-[12px] text-white"
                onClick={() => setEvidenceOpen(true)}
                title={glEv.note}
              >
                Ledger
              </button>
            )}
            {clauses.length > 0 && (
              <button
                type="button"
                className="rounded-full border-2 border-money px-2 py-1 font-serif text-[12px] text-money"
                onClick={() => setEvidenceOpen(true)}
                title={clauses[0]?.rule}
              >
                Contract §
              </button>
            )}
            {timeEv && (
              <button
                type="button"
                className="rounded-full border border-sky/40 bg-sky/15 px-2 py-1 text-[12px]"
                onClick={() => setEvidenceOpen(true)}
              >
                Time record
              </button>
            )}
            {evidence
              .filter((e) => e.source === "precedent")
              .map((e) => (
                <button
                  key={e.ref}
                  type="button"
                  className="rounded-full border border-attention/50 bg-attention-tint px-2 py-1 text-[12px]"
                  onClick={() => setEvidenceOpen(true)}
                >
                  Precedent {e.ref}
                </button>
              ))}
            <button type="button" className="text-[12px] text-sky underline" onClick={() => setEvidenceOpen((o) => !o)}>
              {evidenceOpen ? "Collapse" : "Expand"}
            </button>
          </div>
          {evidenceOpen && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          {bankEv && <EvidenceChip source="bank" label="Bank Ⓑ" body={bankEv.note} />}
          {glEv && (
            <EvidenceChip
              source="gl"
              label="Books Ⓛ"
              body={
                <>
                  {glEv.note}
                  {stewardLabel !== bkLabel && bkLabel && (
                    <p className="mt-2 border-b-2 border-redpen text-ink-2">Disagrees with bookkeeper</p>
                  )}
                </>
              }
            />
          )}
          {clauses.length > 0 && (
            <EvidenceChip
              source="contract"
              label="Contract Ⓒ"
              body={
                <div className="space-y-3">
                  {clauses.map((c) => (
                    <div key={c.ref}>
                      <p className="font-serif text-[16px] text-ink">{c.rule}</p>
                      <p className="mt-1 text-[13px] text-ink-2">{c.ref}</p>
                    </div>
                  ))}
                </div>
              }
            />
          )}
          {timeEv && <EvidenceChip source="time_record" label="Time record Ⓣ" body={timeEv.note} />}
          {evidence
            .filter((e) => e.source === "precedent")
            .map((e) => (
              <EvidenceChip key={e.ref} source="precedent" label={`Precedent Ⓟ ${e.ref}`} body={e.note} />
            ))}
        </div>
          )}
        </div>

        {checks.length > 0 && (
          <ul className="mt-6 max-w-[75ch] space-y-1 text-[13px] text-ink-2">
            {checks.map((c, i) => (
              <li key={i} title={c.ruleId ?? undefined}>
                {c.label}: {c.message}
              </li>
            ))}
          </ul>
        )}

        {entry && lines.length > 0 && (
          <div className="relative mt-8">
            {entryStamp && (
              <RubberStamp
                kind={entryStamp}
                by={stampBy}
                dateLabel={stampDate}
                animate={stampAnimate}
              />
            )}
            <h3 className="text-[17px] font-semibold text-ink">
              <GlossaryTerm term="journal entry">Journal entry</GlossaryTerm>
            </h3>
            <table className="mt-3 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left text-ink-2">
                  <th className="py-2 pr-2 font-medium">Account</th>
                  <th className="py-2 pr-2 font-medium">Fund/Grant</th>
                  <th className="py-2 pr-2 font-medium">Line</th>
                  <th className="py-2 pr-2 text-right font-medium">Debit</th>
                  <th className="py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-rule">
                    <td className="py-2 pr-2">{l.account}</td>
                    <td className="py-2 pr-2">
                      <FundLabelDisplay grantId={l.class} grants={terms} showCode="meta" />
                    </td>
                    <td className="py-2 pr-2">
                      <BudgetLineDisplay grantId={l.class} code={l.budgetLine} grants={terms} />
                    </td>
                    <td className="tabular py-2 pr-2 text-right">{l.debit ? fmtTableAmount(l.debit) : ""}</td>
                    <td className="tabular py-2 text-right">{l.credit ? fmtTableAmount(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-double border-ink">
                  <td colSpan={3} className="py-2" />
                  <td className="tabular py-2 pr-2 text-right font-medium">{fmtTableAmount(dr)}</td>
                  <td className="tabular py-2 text-right font-medium">{fmtTableAmount(cr)}</td>
                </tr>
              </tfoot>
            </table>
            {balanced && <p className="mt-2 text-[13px] font-medium text-money">Balanced</p>}
            {budgetImpacts.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[13px] font-medium text-ink-2">Budget impact</p>
                {budgetImpacts.map((b) => (
                  <p key={b.key} className="text-[13px] text-ink">
                    {b.label.trim()}
                    {"meta" in b && b.meta ? <span className="text-ink-2"> · {b.meta}</span> : null}:{" "}
                    {fmtTableAmount(b.before)} → {fmtTableAmount(b.after)}
                    {b.cap ? ` of ${fmtTableAmount(b.cap)}` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-rule bg-sheet px-6 py-4">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {canWrite && (
            <span className="mr-auto text-[13px] text-ink-2">J/K · A · R · E evidence · ? why · ⌘K</span>
          )}
          <button type="button" onClick={onWhy} className="text-[15px] text-ink-2 underline-offset-2 hover:underline">
            Ask Steward why
          </button>
          {entry ? (
            <>
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => setRejectOpen(true)}
                className="rounded-[4px] border border-rule px-4 py-2 text-[15px] font-medium text-ink disabled:opacity-40"
              >
                Reject…
              </button>
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => void onApprove()}
                className="rounded-[6px] bg-money px-4 py-2 text-[15px] font-medium text-white disabled:opacity-40"
              >
                Approve entry
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => setOverrideOpen(true)}
                className="rounded-[4px] border border-rule px-4 py-2 text-[15px] font-medium text-ink disabled:opacity-40"
              >
                Override…
              </button>
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => (ackOpen ? void onApprove() : setAckOpen(true))}
                className="rounded-[6px] bg-money px-4 py-2 text-[15px] font-medium text-white disabled:opacity-40"
              >
                Acknowledge
              </button>
            </>
          )}
        </div>
        {(forbidReason || actionError) && (
          <p className="mt-2 text-[13px] text-redpen" role="alert">
            {actionError ?? forbidReason}
          </p>
        )}
      </div>

      {ackOpen && !entry && (
        <div className="absolute bottom-20 right-8 z-10 w-72 rounded-[6px] border border-rule bg-sheet p-4 shadow-none">
          <PrecedentFields
            ruleId={decision.ruleHits[0]}
            vendorLabel={vendorLabel}
            precedentScope={precedentScope}
            setPrecedentScope={setPrecedentScope}
            rulingType={rulingType}
            setRulingType={setRulingType}
            onOpen={() => setRulingType(defaultRuling(decision.ruleHits[0]))}
          />
          <label className="text-[13px] text-ink-2">Note (accept Steward&apos;s call)</label>
          <textarea
            className="mt-2 w-full rounded-[4px] border border-rule p-2 text-[15px]"
            rows={3}
            value={ackNote}
            onChange={(e) => setAckNote(e.target.value)}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="text-[13px] text-ink-2" onClick={() => setAckOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!ackNote.trim()}
              onClick={() => void onApprove()}
              className="rounded-[4px] bg-ledger px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {overrideOpen && !entry && (
        <div className="absolute bottom-20 right-8 z-10 w-72 rounded-[6px] border border-rule bg-sheet p-4 shadow-none">
          <label className="text-[13px] text-ink-2">Override note (keep original coding)</label>
          <textarea
            className="mt-2 w-full rounded-[4px] border border-rule p-2 text-[15px]"
            rows={3}
            value={overrideNote}
            onChange={(e) => setOverrideNote(e.target.value)}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="text-[13px] text-ink-2" onClick={() => setOverrideOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!overrideNote.trim()}
              onClick={() => void onOverrideSubmit()}
              className="rounded-[4px] bg-pencil px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
            >
              Override
            </button>
          </div>
        </div>
      )}

      {rejectOpen && (
        <div className="absolute bottom-20 right-8 z-10 w-72 rounded-[6px] border border-rule bg-sheet p-4 shadow-none">
          <PrecedentFields
            ruleId={decision.ruleHits[0]}
            vendorLabel={vendorLabel}
            precedentScope={precedentScope}
            setPrecedentScope={setPrecedentScope}
            rulingType={rulingType}
            setRulingType={setRulingType}
            onOpen={() => setRulingType(defaultRuling(decision.ruleHits[0]))}
          />
          <label className="text-[13px] text-ink-2">Required note</label>
          <textarea
            className="mt-2 w-full rounded-[4px] border border-rule p-2 text-[15px]"
            rows={3}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="text-[13px] text-ink-2" onClick={() => setRejectOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!rejectNote.trim()}
              onClick={() => void onRejectSubmit()}
              className="rounded-[4px] bg-pencil px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
            >
              Reject and record precedent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PrecedentFields({
  ruleId,
  vendorLabel,
  precedentScope,
  setPrecedentScope,
  rulingType,
  setRulingType,
  onOpen,
}: {
  ruleId?: string | null;
  vendorLabel: string;
  precedentScope: "txn" | "vendor";
  setPrecedentScope: (v: "txn" | "vendor") => void;
  rulingType: RulingType;
  setRulingType: (v: RulingType) => void;
  onOpen?: () => void;
}) {
  useEffect(() => {
    onOpen?.();
  }, [ruleId]);
  return (
    <div className="mb-3 space-y-2 text-[13px]">
      <p className="text-ink-2">Apply to:</p>
      <label className="flex gap-2">
        <input
          type="radio"
          checked={precedentScope === "txn"}
          onChange={() => setPrecedentScope("txn")}
        />
        This transaction only
      </label>
      <label className="flex gap-2">
        <input
          type="radio"
          checked={precedentScope === "vendor"}
          onChange={() => setPrecedentScope("vendor")}
        />
        All future charges from {vendorLabel || "this vendor"}
      </label>
      <label className="block">
        Ruling
        <select
          className="mt-1 w-full rounded border border-rule px-2 py-1"
          value={rulingType}
          onChange={(e) => setRulingType(e.target.value as RulingType)}
        >
          <option value="allow">Allow (accept coding)</option>
          <option value="disallow">Disallow (move off grant)</option>
          <option value="prior_approval_granted">Prior approval granted</option>
          <option value="not_duplicate">Not a duplicate</option>
        </select>
      </label>
    </div>
  );
}

