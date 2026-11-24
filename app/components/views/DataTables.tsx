"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { lineNameFromGrants } from "@/lib/codingLabel";
import { getFundLabel } from "@/lib/fundLabels";
import type { GrantTerms } from "@/lib/types";
import { TransactionsVirtualTable } from "../TransactionsVirtualTable";
import { Card } from "../ui/Card";
import { fmtUsd } from "../ui/Money";

/** Every GL line with Steward's coding. Virtualised: a year of GL detail can run to thousands of rows. */
export function LedgerTable({ grantTerms }: { grantTerms: GrantTerms[] }) {
  const ledger = useQuery(api.ui.transactionLedger);
  const [filter, setFilter] = useState<"all" | "exceptions" | "clean">("all");
  if (ledger === undefined) return <Card className="h-[60vh] animate-pulse">{null}</Card>;
  const rows = ledger.filter((r) => (filter === "all" ? true : filter === "clean" ? r.status === "auto" : r.status !== "auto"));
  const ln = (gid: string | null, code: string | null) => lineNameFromGrants(grantTerms, gid, code);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Ledger filter">
        {(["all", "exceptions", "clean"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-11 rounded-pill border px-3 text-sm sm:min-h-8 ${filter === f ? "border-ink bg-ink text-sheet" : "border-rule-strong bg-sheet hover:border-ink-2"}`}
          >
            {{ all: "All", exceptions: "Exceptions", clean: "Clean" }[f]} <span className="tabular opacity-70">{f === "all" ? ledger.length : f === "clean" ? ledger.filter((r) => r.status === "auto").length : ledger.filter((r) => r.status !== "auto").length}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-base text-ink-2">No lines here.</Card>
      ) : (
        <TransactionsVirtualTable rows={rows} grantTerms={grantTerms} lineName={ln} />
      )}
    </div>
  );
}

/** The confirmed terms of each contract: budget, billing, and the clauses Steward enforces, quoted. */
export function TermsSheets() {
  const grants = useQuery(api.ui.grantsSheets);
  if (grants === undefined) return <Card className="h-[50vh] animate-pulse">{null}</Card>;
  const ready = grants.filter((g) => g.terms && g.status === "ready");
  if (!ready.length) return <Card className="p-8 text-center text-base text-ink-2">No confirmed contracts yet.</Card>;
  return (
    <div className="space-y-4">
      {ready.map((g) => {
        const t = g.terms as GrantTerms;
        const fund = getFundLabel(t.grantId, [t]);
        return (
          <Card as="article" key={g._id} className="p-5 sm:p-8">
            <p className="text-sm text-ink-2">
              {fund.subtitle} · {t.grantId}
            </p>
            <h2 className="mt-1 font-serif text-xl text-ink">{fund.title}</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-ink-2">Award</dt>
                <dd className="tabular text-base">{fmtUsd(Math.round(t.totalAward * 100))}</dd>
              </div>
              <div>
                <dt className="text-ink-2">Period</dt>
                <dd className="tabular text-base">
                  {t.periodStart} – {t.periodEnd}
                </dd>
              </div>
              <div>
                <dt className="text-ink-2">Billing</dt>
                <dd className="text-base">
                  {t.billing?.frequency === "monthly" ? "Monthly" : t.billing?.frequency === "quarterly" ? "Quarterly" : "Once"}
                  {t.billing?.invoiceDueDays != null ? `, due ${t.billing.invoiceDueDays} days after` : ""}
                  {t.billing?.costBasis ? ` · ${t.billing.costBasis}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-ink-2">Indirect</dt>
                <dd className="text-base">
                  {t.indirectCapPct != null ? `${t.indirectCapPct}% of ${t.indirectBase ?? "direct costs"}` : "None stated"}
                </dd>
              </div>
            </dl>
            <ul className="mt-6 divide-y divide-rule border-y border-rule">
              {t.budgetLines.map((bl) => {
                const spent = g.spentByLine[`${t.grantId}:${bl.code}`] ?? 0;
                const budget = Math.round(bl.amount * 100);
                const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
                return (
                  <li key={bl.code} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-2.5 text-sm">
                    <span>
                      {bl.name} <span className="text-ink-2">{bl.code}</span>
                    </span>
                    <span className="tabular text-ink-2">
                      {fmtUsd(spent)} of {fmtUsd(budget)}
                    </span>
                    <span className="col-span-2 h-1 overflow-hidden rounded-pill bg-paper-2" aria-hidden>
                      <span className="block h-full rounded-pill bg-ink" style={{ width: `${pct}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
            {(t.unallowable.length > 0 || t.priorApproval.length > 0) && (
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                {t.unallowable.length > 0 && (
                  <section>
                    <h3 className="text-xs font-medium text-ink-2">Not allowed</h3>
                    <ul className="mt-2 space-y-3">
                      {t.unallowable.map((u, i) => (
                        <li key={`${u.clauseRef}-${i}`}>
                          <p className="font-serif text-md leading-snug">“{u.rule}”</p>
                          <p className="mt-0.5 text-xs text-ink-2">{u.clauseRef}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {t.priorApproval.length > 0 && (
                  <section>
                    <h3 className="text-xs font-medium text-ink-2">Needs the funder&apos;s approval first</h3>
                    <ul className="mt-2 space-y-3">
                      {t.priorApproval.map((p, i) => (
                        <li key={`${p.clauseRef}-${i}`}>
                          <p className="font-serif text-md leading-snug">“{p.rule}”</p>
                          <p className="mt-0.5 text-xs text-ink-2">
                            {p.clauseRef}
                            {p.thresholdUsd != null ? ` · over ${fmtUsd(p.thresholdUsd * 100)}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
