"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { BillingPackage, TieOutCheck } from "@/lib/tieOut";
import type { GrantTerms } from "@/lib/types";
import { messageFromConvexError } from "../../lib/convexError";
import { useNowMs } from "../../hooks/useNowMs";
import { packageKey, parsePackageKey, type AppUrl } from "../../hooks/useAppUrlState";
import {
  CHECK_ORDER,
  checkTitle,
  dueLabel,
  idsInDetail,
  monthName,
  periodLabel,
  shortDate,
  statusWord,
  type PackageSummary,
} from "../../lib/packageText";
import { shortName, useApp } from "../AppContext";
import { RubberStamp } from "../RubberStamp";
import { Badge } from "../ui/Badge";
import { Button, ButtonLink } from "../ui/Button";
import { Card, SectionTitle } from "../ui/Card";
import { fmtUsd, Money } from "../ui/Money";
import { ProgressBar } from "../ui/ProgressBar";
import { Table, Td, Th } from "../ui/Table";

type Detail = PackageSummary & { package: BillingPackage; live: boolean };

/** Stamps animate only for the signature that just happened in this tab. */
const justSigned = new Set<string>();

export function PackageView({ url, grantTerms }: { url: AppUrl; grantTerms: GrantTerms[] }) {
  const key = parsePackageKey(url.packageId);
  const list = useQuery(api.packages.list) as PackageSummary[] | undefined;
  const summary = key ? list?.find((p) => p.grantId === key.grantId && p.periodStart === key.periodStart) : undefined;
  const detail = useQuery(
    api.packages.get,
    summary ? { grantId: summary.grantId, periodStart: summary.periodStart, periodEnd: summary.periodEnd } : "skip",
  ) as Detail | null | undefined;

  if (!key || (list && !summary)) {
    return (
      <div className="mx-auto max-w-[640px] py-16 text-center">
        <h1 className="font-serif text-xl">That package isn&apos;t here.</h1>
        <p className="mt-3 text-base text-ink-2">It may belong to data that was replaced. Pick one from the list.</p>
        <Button variant="primary" className="mt-6" onClick={() => url.setTab("packages")}>
          See all packages
        </Button>
      </div>
    );
  }
  if (!detail) return <PackageSkeleton />;
  return <PackageSheet d={detail} url={url} grantTerms={grantTerms} />;
}

function PackageSheet({ d, url, grantTerms }: { d: Detail; url: AppUrl; grantTerms: GrantTerms[] }) {
  const nowMs = useNowMs();
  const pkg = d.package;
  const terms = grantTerms.find((g) => g.grantId === d.grantId);
  const key = packageKey(d.grantId, d.periodStart);
  const status = statusWord(d);
  const due = dueLabel(d.dueDate, nowMs);
  const failing = pkg.checks.filter((c) => !c.pass);
  const checks = [...pkg.checks].sort(
    (a, b) => Number(a.pass) - Number(b.pass) || CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id),
  );
  const done = d.status === "signed" || d.status === "exported";
  const month = d.frequency === "monthly" ? monthName(d.periodStart) : null;

  return (
    <div className="mx-auto max-w-[1040px]">
      <nav aria-label="Breadcrumb" className="no-print mb-4 text-sm text-ink-2">
        <button type="button" onClick={() => url.setTab("packages")} className="min-h-11 hover:text-ink sm:min-h-0">
          ← All packages
        </button>
      </nav>

      <Card className="print-sheet relative overflow-hidden">
        {/* Header: Z-pattern. Who/what top-left, the one number top-right, state below. */}
        <div className="grid gap-x-10 gap-y-5 p-5 sm:grid-cols-[1fr_auto] sm:p-8">
          <div className="min-w-0">
            <p className="text-sm text-ink-2">
              {d.funder.replace(/\s*\(fictional[^)]*\)/i, "")} · {d.grantId}
            </p>
            <h1 className="mt-2 font-serif text-xl leading-tight text-ink text-balance sm:text-2xl">
              {periodLabel(d.periodStart, d.periodEnd)} <em className="italic text-ink-2">{d.program}</em>
            </h1>
            <p className="mt-2 text-sm text-ink-2">
              Invoice <span className="tabular text-ink">{d.invoiceNo}</span> · {pkg.lines.length} lines
              {pkg.excluded.length ? ` · ${pkg.excluded.length} moved off this grant` : ""}
            </p>
          </div>
          <div className="relative sm:text-right">
            <p className="text-xs text-ink-2">{done ? "Billed" : "Claimable this period"}</p>
            <Money cents={pkg.invoiceTotalCents} focal className="block text-2xl font-medium tracking-[-0.025em] sm:text-3xl" />
            {done && d.reviewedBy && d.signedAt && (
              <RubberStamp
                by={shortName(d.reviewedBy)}
                dateLabel={shortDate(d.signedAt, true)}
                animate={justSigned.has(key)}
                className="absolute -bottom-12 right-0 sm:-bottom-14"
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule px-5 py-3 sm:px-8">
          <Badge tone={status.tone}>{status.text}</Badge>
          {!done && <span className={`text-sm ${due.overdue ? "font-medium text-redpen-ink" : "text-ink-2"}`}>{due.text}</span>}
          <span className="text-sm text-ink-2">
            {d.preparedBy ? `Prepared by ${shortName(d.preparedBy)}` : "Not sent for review yet"}
            {d.reviewedBy ? ` · Signed by ${shortName(d.reviewedBy)}` : ""}
          </span>
          {!d.live && <span className="text-sm text-ink-2">Numbers frozen at signing</span>}
        </div>

        {/* Tie-out */}
        <section aria-labelledby="tieout" className="border-t border-rule px-5 py-6 sm:px-8 print-avoid">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle id="tieout" accent="to the cent">
              Tie-out
            </SectionTitle>
            <div className="flex w-full items-center gap-3 sm:w-auto">
              <ProgressBar
                value={pkg.checks.length - failing.length}
                max={pkg.checks.length}
                label="Checks passing"
                className="sm:w-40"
              />
              <span className="tabular whitespace-nowrap text-sm text-ink-2">
                {pkg.checks.length - failing.length} of {pkg.checks.length}
              </span>
            </div>
          </div>
          {failing.length === 0 ? (
            <p className="mt-3 text-base font-medium text-green-ink">
              All {pkg.checks.length} checks pass{done ? "." : " — ready to sign."}
            </p>
          ) : (
            <p className="mt-3 max-w-[70ch] text-base text-ink">
              {failing.length === 1 ? "One failing check" : `${failing.length} failing checks`} would send the{" "}
              {month ? `${month} ` : ""}invoice back. Each one below names the lines to fix.
            </p>
          )}
          <ul className="mt-5 divide-y divide-rule border-y border-rule">
            {checks.map((c) => (
              <CheckRow key={c.id} c={c} d={d} pkgKey={key} url={url} />
            ))}
          </ul>
        </section>

        {/* Expenditure report */}
        <section aria-labelledby="report" className="border-t border-rule px-5 py-6 sm:px-8 print-avoid">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle id="report" accent="budget vs actual">
              Expenditure report
            </SectionTitle>
            <div className="no-print flex gap-4 text-sm">
              <Link href="/app?tab=data&view=ledger" className="text-ink-2 underline underline-offset-4 hover:text-ink">
                Ledger
              </Link>
              <Link href="/app?tab=data&view=terms" className="text-ink-2 underline underline-offset-4 hover:text-ink">
                Contract terms
              </Link>
            </div>
          </div>
          <ReportTable pkg={pkg} />
          <IndirectNote pkg={pkg} terms={terms} />
        </section>

        <LineDetail pkg={pkg} />

        <SignatureBlock d={d} />

        <AuditTrail packageId={d.packageId} />

        <Actions d={d} pkgKey={key} />
      </Card>
    </div>
  );
}

function checkNumbers(c: TieOutCheck): string | null {
  const n = c.numbers;
  switch (c.id) {
    case "SUM_TIES":
      return `Lines ${fmtUsd(n.detailCents ?? 0)} ${n.detailCents === n.invoiceTotalCents ? "=" : "≠"} invoice ${fmtUsd(n.invoiceTotalCents ?? 0)} · GL ${fmtUsd(n.glTotalCents ?? 0)} − moved off ${fmtUsd(n.excludedCents ?? 0)} + moved on ${fmtUsd(n.movedOnCents ?? 0)}`;
    case "INDIRECT_ROUNDING":
      return n.rateBps
        ? `${(n.rateBps / 100).toFixed(2).replace(/\.?0+$/, "")}% × ${fmtUsd(n.baseCents ?? 0)} = ${fmtUsd(n.computedCents ?? 0)} · claimed ${fmtUsd(n.claimedCents ?? 0)}`
        : null;
    case "CUMULATIVE_WITHIN_BUDGET":
      return `${fmtUsd(n.cumulativeCents ?? 0)} of ${fmtUsd(n.awardCents ?? 0)} award billed to date`;
    case "RECEIPTS":
      return `Threshold ${fmtUsd(n.thresholdCents ?? 0)}`;
    default:
      return null;
  }
}

function CheckRow({ c, d, pkgKey, url }: { c: TieOutCheck; d: Detail; pkgKey: string; url: AppUrl }) {
  const app = useApp();
  const approve = useMutation(api.programApprovals.approveLines);
  const [busy, setBusy] = useState(false);
  const numbers = checkNumbers(c);
  let ids = idsInDetail(c.detail);
  if (c.id === "INDIRECT_ROUNDING" && d.package.indirect.line) {
    ids = [...new Set(d.package.lines.filter((l) => l.budgetLine === d.package.indirect.line).map((l) => l.txnId))];
  }
  const unapproved =
    c.id === "PROGRAM_APPROVAL"
      ? [...new Set(d.package.lines.filter((l) => !l.programApprovedBy && !l.resolvedBy).map((l) => l.txnId))]
      : [];
  const frozen = d.status === "signed" || d.status === "exported";

  async function approveAll() {
    setBusy(true);
    try {
      const n = await approve({ txnIds: unapproved, by: app.actor, note: `Program approval for ${d.invoiceNo}`, passcode: app.passcode });
      app.toast(`${n} ${n === 1 ? "line" : "lines"} approved for the program by ${shortName(app.actor)}`);
    } catch (e) {
      app.fail(messageFromConvexError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid grid-cols-[20px_1fr] gap-x-3 py-3.5 sm:grid-cols-[20px_1fr_auto] sm:items-center">
      <span aria-hidden className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-pill ${c.pass ? "bg-green-tint text-green-ink" : "bg-redpen-tint text-redpen-ink"}`}>
        {c.pass ? (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2 5 8.6l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        )}
      </span>
      <div className="min-w-0">
        <p className={`text-base ${c.pass ? "text-ink" : "font-medium text-ink"}`}>
          <span className="sr-only">{c.pass ? "Passes: " : "Fails: "}</span>
          {checkTitle(c.id, c.pass, c.numbers)}
        </p>
        {numbers && <p className="tabular mt-0.5 text-sm text-ink-2">{numbers}</p>}
        {!c.pass && <p className="mt-0.5 max-w-[78ch] text-sm text-ink-2">{c.detail}</p>}
      </div>
      {!c.pass && !frozen && (
        <div className="no-print col-start-2 mt-2 flex flex-wrap gap-2 sm:col-start-3 sm:mt-0 sm:justify-end">
          {c.id === "PROGRAM_APPROVAL" && unapproved.length > 0 ? (
            app.isProgramApprover ? (
              <Button size="sm" busy={busy} disabled={!app.canWrite} onClick={() => void approveAll()}>
                Approve {unapproved.length} {unapproved.length === 1 ? "line" : "lines"} for the program
              </Button>
            ) : (
              <span className="text-sm text-ink-2">A program approver signs these off</span>
            )
          ) : ids.length > 0 ? (
            <Button size="sm" onClick={() => url.openCase(ids[0]!, pkgKey)}>
              {ids.length === 1 ? `Fix ${ids[0]}` : `Fix ${ids.length} lines`} →
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

function ReportTable({ pkg }: { pkg: BillingPackage }) {
  const rows = pkg.budgetVsActual;
  const sum = (k: "budgetCents" | "priorCents" | "currentCents" | "cumulativeCents" | "remainingCents") =>
    rows.reduce((a, r) => a + r[k], 0);
  return (
    <Table caption="Expenditure report: budget versus actual by line" className="mt-4" minWidth={640}>
      <thead>
        <tr>
          <Th>Budget line</Th>
          <Th align="right">Budget</Th>
          <Th align="right">Prior periods</Th>
          <Th align="right">This period</Th>
          <Th align="right">Cumulative</Th>
          <Th align="right">Remaining</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const over = r.cumulativeCents > r.capCents;
          return (
            <tr key={r.code}>
              <Td>
                <span className="text-ink">{r.name}</span> <span className="text-ink-2">{r.code}</span>
                {r.code === pkg.indirect.line && <span className="text-ink-2"> · indirect</span>}
              </Td>
              <Td money className="text-ink-2">{fmtUsd(r.budgetCents)}</Td>
              <Td money className="text-ink-2">{fmtUsd(r.priorCents)}</Td>
              <Td money className="font-medium text-ink">{fmtUsd(r.currentCents)}</Td>
              <Td money className={over ? "font-medium text-redpen-ink" : ""}>{fmtUsd(r.cumulativeCents)}</Td>
              <Td money className={r.remainingCents < 0 ? "text-redpen-ink" : "text-ink-2"}>{fmtUsd(r.remainingCents)}</Td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="font-medium">
          <Td className="border-b-0 border-t-2 border-t-ink">Total</Td>
          <Td money className="border-b-0 border-t-2 border-t-ink">{fmtUsd(sum("budgetCents"))}</Td>
          <Td money className="border-b-0 border-t-2 border-t-ink">{fmtUsd(sum("priorCents"))}</Td>
          <Td money className="border-b-0 border-t-2 border-t-ink">{fmtUsd(sum("currentCents"))}</Td>
          <Td money className="border-b-0 border-t-2 border-t-ink">{fmtUsd(sum("cumulativeCents"))}</Td>
          <Td money className="border-b-0 border-t-2 border-t-ink">{fmtUsd(sum("remainingCents"))}</Td>
        </tr>
      </tfoot>
    </Table>
  );
}

function IndirectNote({ pkg, terms }: { pkg: BillingPackage; terms: GrantTerms | undefined }) {
  const i = pkg.indirect;
  if (i.rateBps == null) return null;
  const base = i.base === "salaries" ? "salaries" : i.base === "mtdc" ? "modified total direct costs" : "direct costs";
  return (
    <p className="mt-3 text-sm text-ink-2">
      Indirect at {(i.rateBps / 100).toFixed(2).replace(/\.?0+$/, "")}% of {base} ({fmtUsd(i.baseCents)}) ={" "}
      <span className="tabular text-ink">{fmtUsd(i.computedCents)}</span>; claimed on {i.line ?? "no indirect line"}{" "}
      <span className={`tabular ${i.computedCents === i.claimedCents ? "text-ink" : "font-medium text-redpen-ink"}`}>
        {fmtUsd(i.claimedCents)}
      </span>
      .{terms?.billing?.costBasis === "reimbursement" ? " Cost reimbursement: billed indirect must equal the rate exactly." : ""}
    </p>
  );
}

function LineDetail({ pkg }: { pkg: BillingPackage }) {
  return (
    <section className="border-t border-rule px-5 py-5 sm:px-8">
      <details className="group">
        <summary className="no-print flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base text-ink">
          <span>
            Line detail <span className="text-ink-2">· {pkg.lines.length} lines{pkg.excluded.length ? `, ${pkg.excluded.length} moved off` : ""}</span>
          </span>
          <span aria-hidden className="text-ink-2 transition-transform duration-150 group-open:rotate-90">›</span>
        </summary>
        <Table caption="Line detail billed this period" className="mt-3" minWidth={720}>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Vendor</Th>
              <Th>Line</Th>
              <Th>Receipt</Th>
              <Th>Program approval</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {pkg.lines.map((l, i) => (
              <tr key={`${l.txnId}-${l.budgetLine}-${i}`}>
                <Td className="tabular whitespace-nowrap text-ink-2">{shortDate(l.date)}</Td>
                <Td>
                  <span className="text-ink">{l.vendor}</span> <span className="text-ink-2">{l.txnId}</span>
                </Td>
                <Td className="text-ink-2">{l.budgetLine}</Td>
                <Td className="text-ink-2">{l.receiptId ? "On file" : "—"}</Td>
                <Td className="text-ink-2">{l.programApprovedBy ? shortName(l.programApprovedBy) : l.resolvedBy ? `Resolved by ${shortName(l.resolvedBy)}` : "—"}</Td>
                <Td money>{fmtUsd(l.amountCents)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {pkg.excluded.length > 0 && (
          <>
            <h3 className="mt-6 text-sm font-medium text-ink">Moved off this grant</h3>
            <ul className="mt-2 divide-y divide-rule border-y border-rule">
              {pkg.excluded.map((x) => (
                <li key={x.txnId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="text-ink">{x.vendor}</span> <span className="text-ink-2">{x.txnId} · {x.reason}</span>
                  </span>
                  <span className="tabular text-ink-2">{fmtUsd(x.amountCents)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}

function SignatureBlock({ d }: { d: Detail }) {
  return (
    <section className="print-only border-t border-rule px-8 py-6">
      <div className="grid grid-cols-2 gap-10 text-sm">
        <div>
          <p className="text-ink-2">Prepared by</p>
          <p className="mt-6 border-b border-ink pb-1">{d.preparedBy ?? ""}</p>
        </div>
        <div>
          <p className="text-ink-2">Reviewed and signed by</p>
          <p className="mt-6 border-b border-ink pb-1">
            {d.reviewedBy ?? ""} {d.signedAt ? `· ${shortDate(d.signedAt, true)}` : ""}
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-2">Prepared with Steward. Steward does not sign, post or move money.</p>
    </section>
  );
}

const AUDIT_WORDS: Record<string, string> = {
  package_ready: "marked it ready for review",
  package_signed: "signed it",
  package_reopened: "reopened it",
  package_exported: "exported it",
};

function AuditTrail({ packageId }: { packageId: string | null }) {
  const rows = useQuery(api.ui.packageAudit, packageId ? { packageId: packageId as Id<"packages"> } : "skip");
  if (!packageId || !rows?.length) return null;
  return (
    <section aria-label="Who did what" className="border-t border-rule px-5 py-4 sm:px-8">
      <ul className="space-y-1 text-sm text-ink-2">
        {rows.map((r, i) => (
          <li key={`${r.at}-${i}`}>
            <span className="text-ink">{shortName(r.actor)}</span> {AUDIT_WORDS[r.action] ?? r.action.replace(/_/g, " ")}{" "}
            · {shortDate(r.at, true)}, {new Date(r.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            {r.action === "package_reopened" && r.why ? ` — “${r.why}”` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Actions({ d, pkgKey }: { d: Detail; pkgKey: string }) {
  const app = useApp();
  const markReady = useMutation(api.packages.markReady);
  const sign = useMutation(api.packages.sign);
  const reopen = useMutation(api.packages.reopen);
  const markExported = useMutation(api.packages.markExported);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"sign" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const failing = d.package.checks.filter((c) => !c.pass);
  const isOwnPrep = !!d.preparedBy && d.preparedBy === app.actor;

  async function act(name: string, fn: () => Promise<unknown>, done: string) {
    setBusy(name);
    try {
      await fn();
      app.toast(done);
      setConfirming(null);
      setReason("");
    } catch (e) {
      app.fail(messageFromConvexError(e));
    } finally {
      setBusy(null);
    }
  }

  let signBlock: string | null = null;
  if (d.status === "ready_for_review") {
    if (!app.isReviewer) signBlock = "Only a reviewer can sign. Switch “Acting as” to a reviewer.";
    else if (isOwnPrep) signBlock = "You prepared this package, so someone else has to sign it.";
    else if (failing.length) signBlock = `Signing opens once all checks pass (${failing.length} still ${failing.length === 1 ? "fails" : "fail"}).`;
  }

  return (
    <div className="no-print border-t border-rule bg-paper/60 px-5 py-5 sm:px-8">
      {confirming === "sign" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-base">
            Sign invoice <span className="tabular">{d.invoiceNo}</span> for{" "}
            <Money cents={d.package.invoiceTotalCents} className="font-medium" />? The numbers freeze; reopening needs a reason.
          </p>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy === "sign"}
            busyLabel="Signing…"
            onClick={() => {
              justSigned.add(pkgKey);
              void act("sign", () => sign({ packageId: d.packageId as Id<"packages">, by: app.actor, passcode: app.passcode }), `Signed by ${shortName(app.actor)}`);
            }}
          >
            Sign package
          </Button>
        </div>
      ) : confirming === "reopen" ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            void act("reopen", () => reopen({ packageId: d.packageId as Id<"packages">, by: app.actor, reason, passcode: app.passcode }), "Package reopened as a draft");
          }}
        >
          <label className="min-w-[240px] flex-1 text-sm text-ink-2">
            Why reopen it? (kept in the audit trail)
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-sm border border-rule-strong bg-sheet px-3 text-base text-ink sm:min-h-10"
            />
          </label>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!reason.trim()} busy={busy === "reopen"}>
            Reopen package
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {d.status === "draft" && (
            <>
              <Button
                variant="primary"
                disabled={!app.isPreparer || !app.canWrite}
                busy={busy === "ready"}
                onClick={() =>
                  void act(
                    "ready",
                    () => markReady({ grantId: d.grantId, periodStart: d.periodStart, periodEnd: d.periodEnd, by: app.actor, passcode: app.passcode }),
                    "Sent to the reviewer",
                  )
                }
              >
                Mark ready for review
              </Button>
              <p className="min-w-0 flex-1 text-sm text-ink-2">
                {!app.isPreparer
                  ? "The preparer sends this to the reviewer. Switch “Acting as” to a preparer."
                  : failing.length
                    ? `${failing.length} ${failing.length === 1 ? "check still fails" : "checks still fail"}; the reviewer can't sign until they pass.`
                    : "Every check passes. Send it to the reviewer."}
              </p>
            </>
          )}
          {d.status === "ready_for_review" && (
            <>
              <Button
                variant="primary"
                disabled={!!signBlock || !app.canWrite}
                aria-describedby="sign-why"
                onClick={() => setConfirming("sign")}
              >
                Sign package
              </Button>
              <p id="sign-why" className="min-w-0 flex-1 text-sm text-ink-2">
                {signBlock ?? "All checks pass. Steward can't sign; you can."}
              </p>
            </>
          )}
          {(d.status === "signed" || d.status === "exported") && d.packageId && (
            <>
              <ButtonLink
                href={`/api/package/${d.packageId}/csv`}
                download
                variant="primary"
                onClick={() => {
                  if (d.status === "signed") void markExported({ packageId: d.packageId as Id<"packages">, by: app.actor, passcode: app.passcode }).catch(() => {});
                }}
              >
                Export CSV
              </ButtonLink>
              <p className="min-w-0 flex-1 text-sm text-ink-2">
                {d.status === "exported" ? "Exported. The CSV is built from the signed snapshot." : "Signed. Export the expenditure report for the funder."}
              </p>
            </>
          )}
          <div className="flex gap-2">
            <Button onClick={() => window.print()}>Print / PDF</Button>
            {d.status !== "draft" && d.packageId && (app.isReviewer || app.isPreparer) && (
              <Button variant="ghost" onClick={() => setConfirming("reopen")}>
                Reopen…
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PackageSkeleton() {
  return (
    <div className="mx-auto max-w-[1040px] animate-pulse" aria-busy aria-label="Loading package">
      <div className="mb-4 h-5 w-28 rounded-sm bg-paper-2" />
      <div className="h-[520px] rounded-md border border-rule bg-sheet" />
    </div>
  );
}
