"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { GrantTerms } from "@/lib/types";
import { stewardCodingLabel } from "@/lib/codingLabel";
import { fmtTableAmount } from "../format";
import { RedPenStrike } from "./RedPenStrike";

type Row = {
  txnId: string;
  date: string;
  description: string;
  memo: string;
  amountCents: number;
  grantId: string | null;
  budgetLine: string | null;
  splits?: unknown;
  status: string;
};

export function TransactionsVirtualTable({
  rows,
  grantTerms,
  lineName,
}: {
  rows: Row[];
  grantTerms: GrantTerms[];
  lineName: (gid: string | null, code: string | null) => string | undefined;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  return (
    <div ref={parentRef} className="max-h-[70vh] overflow-auto rounded-md border border-rule bg-sheet shadow-sheet">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <caption className="sr-only">Ledger lines with Steward&apos;s coding</caption>
        <thead className="sticky top-0 z-10 bg-sheet">
          <tr className="border-b border-rule text-left text-xs text-ink-2">
            <th scope="col" className="px-3 py-2 font-medium">Date</th>
            <th scope="col" className="px-3 py-2 font-medium">Description</th>
            <th scope="col" className="px-3 py-2 font-medium">Memo</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
            <th scope="col" className="px-3 py-2 font-medium">Steward&apos;s coding</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const r = rows[vRow.index]!;
            return (
              <tr
                key={r.txnId}
                className="absolute left-0 w-full border-b border-rule"
                style={{ transform: `translateY(${vRow.start}px)`, height: `${vRow.size}px` }}
              >
                <td className="tabular whitespace-nowrap px-3 py-2 text-ink-2">{r.date}</td>
                <td className="max-w-[220px] truncate px-3 py-2">{r.description} <span className="text-ink-2">{r.txnId}</span></td>
                <td className="max-w-[120px] truncate px-3 py-2 text-ink-2">{r.memo}</td>
                <td className="tabular px-3 py-2 text-right">{fmtTableAmount(r.amountCents)}</td>
                <td className="px-3 py-2">
                  {r.status === "blocked" && r.grantId ? (
                    <RedPenStrike
                      text={stewardCodingLabel({
                        amountCents: r.amountCents,
                        grantId: r.grantId,
                        budgetLine: r.budgetLine,
                        lineName,
                        grants: grantTerms,
                        description: r.description,
                        memo: r.memo,
                      })}
                    />
                  ) : (
                    stewardCodingLabel({
                      amountCents: r.amountCents,
                      grantId: r.grantId,
                      budgetLine: r.budgetLine,
                      lineName,
                      splits: r.splits as { grantId: string | null; budgetLine: string | null; amount: number }[] | undefined,
                      grants: grantTerms,
                      description: r.description,
                      memo: r.memo,
                    })
                  )}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 ${r.status === "blocked" ? "text-redpen-ink" : r.status === "auto" ? "text-ink-2" : "text-amber-ink"}`}>
                  {r.status === "auto" ? "Clean" : r.status === "blocked" ? "Not allowed" : "Needs you"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
