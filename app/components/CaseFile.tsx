"use client";

import type { ReactNode } from "react";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { contractClausesFromDecision } from "@/lib/clauseText";
import { stewardCodingLabel } from "@/lib/codingLabel";
import type { GrantTerms } from "@/lib/types";
import { fmtSentenceAmount, fmtTableAmount } from "../format";
import { RedPenStrike } from "./RedPenStrike";

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

export function CaseFile({
  data,
  actingAsSteward,
  actorName,
  onToast,
  onWhy,
  strikeKey,
}: {
  data: CaseData | null | undefined;
  actingAsSteward: boolean;
  actorName: string;
  onToast: (m: string) => void;
  onWhy: () => void;
  strikeKey: string;
}) {
  const approve = useMutation(api.approvals.approveEntry);
  const reject = useMutation(api.approvals.rejectEntry);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const seenStrike = useRef(new Set<string>());

  useEffect(() => {
    if (data?.txn?.txnId) seenStrike.current.add(strikeKey);
  }, [data?.txn?.txnId, strikeKey]);

  if (!data?.txn || !data.decision) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[15px] text-ink-2">
        Select an exception from the queue.
      </div>
    );
  }

  const { txn, decision, gl, entry, grantTerms } = data;
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
    if (!entry || actingAsSteward) return;
    await approve({ entryId: entry.id, by: actorName, note: "Approved in inbox review" });
    onToast("Entry approved");
  }

  async function onRejectSubmit() {
    if (!entry || !rejectNote.trim() || actingAsSteward) return;
    await reject({ entryId: entry.id, by: actorName, note: rejectNote.trim() });
    setRejectOpen(false);
    setRejectNote("");
    onToast("Entry rejected");
  }

  const bankEv = evidence.find((e) => e.source === "bank");
  const glEv = evidence.find((e) => e.source === "gl");
  const timeEv = evidence.find((e) => e.source === "time_record");
  const whyText = decision.modelRationale ?? decision.rationale;
  const checks = decision.checks ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex items-start justify-between gap-4 border-b border-rule pb-4">
          <div>
            <h2 className="text-[22px] font-semibold leading-[1.2] text-ink">{txn.description}</h2>
            <p className="mt-1 text-[13px] text-ink-2">{txn.date}</p>
          </div>
          <p className="tabular text-[32px] font-semibold leading-[1.2] text-ink">
            {fmtSentenceAmount(txn.amountCents)}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          {bkLabel ? (
            <RedPenStrike text={bkLabel} className="text-[15px]" />
          ) : (
            <span className="text-[15px] text-ink-2">Not yet coded</span>
          )}
          <span className="text-[17px] font-semibold text-ledger">{stewardLabel}</span>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {bankEv && <Cell label="Bank Ⓑ" body={bankEv.note} disagree={false} />}
          {glEv && (
            <Cell label="Books Ⓛ" body={glEv.note} disagree={stewardLabel !== bkLabel && !!bkLabel} />
          )}
          {clauses.length > 0 && (
            <Cell
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
              disagree={decision.status === "blocked"}
            />
          )}
          {timeEv && <Cell label="Time record Ⓣ" body={timeEv.note} disagree={false} />}
        </div>

        <div className="mt-8 max-w-[75ch]">
          <p className="text-[15px] text-ink">{whyText}</p>
          {checks.length > 0 && (
            <ul className="mt-4 space-y-2 text-[15px] text-ink">
              {checks.map((c, i) => (
                <li key={i} title={c.ruleId ?? undefined}>
                  <span className="text-ink-2">{c.tick}</span> {c.label}: {c.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        {entry && lines.length > 0 && (
          <div className="mt-8">
            <h3 className="text-[17px] font-semibold text-ink">Proposed journal entry</h3>
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
                    <td className="py-2 pr-2">{l.class ?? "Unrestricted"}</td>
                    <td className="py-2 pr-2">{l.budgetLine ?? "—"}</td>
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
            {balanced && <p className="mt-2 text-[13px] font-medium text-ledger">Balanced</p>}
          </div>
        )}

        <p className="mt-10 text-[13px] text-ink-2">
          Ⓑ agreed to bank · Ⓛ agreed to ledger · Ⓒ agreed to contract · Ⓣ agreed to time records · Ⓟ precedent
        </p>
      </div>

      <div className="border-t border-rule px-6 py-4">
        {actingAsSteward ? (
          <p className="text-[13px] text-ink-2">
            Steward can propose entries but can&apos;t approve them (segregation of duties).
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-[13px] text-ink-2">A approve · R reject · ? ask why</span>
            <button type="button" onClick={onWhy} className="text-[15px] text-ink-2 underline-offset-2 hover:underline">
              Ask Steward why
            </button>
            <button
              type="button"
              disabled={!entry}
              onClick={() => setRejectOpen(true)}
              className="rounded-[4px] border border-rule px-4 py-2 text-[15px] font-medium text-ink disabled:opacity-40"
            >
              Reject…
            </button>
            <button
              type="button"
              disabled={!entry}
              onClick={() => void onApprove()}
              className="rounded-[4px] bg-ledger px-4 py-2 text-[15px] font-medium text-white disabled:opacity-40"
            >
              Approve entry
            </button>
          </div>
        )}
      </div>

      {rejectOpen && (
        <div className="absolute bottom-20 right-8 z-10 w-72 rounded-[6px] border border-rule bg-sheet p-4 shadow-none">
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

function Cell({
  label,
  body,
  disagree,
}: {
  label: string;
  body: ReactNode;
  disagree: boolean;
}) {
  return (
    <div className={`rounded-[4px] border border-rule p-3 ${disagree ? "border-b-2 border-b-redpen" : ""}`}>
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
      <div className="mt-2 text-[13px] text-ink">{body}</div>
    </div>
  );
}
