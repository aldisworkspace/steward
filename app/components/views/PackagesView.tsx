"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNowMs } from "../../hooks/useNowMs";
import { packageKey } from "../../hooks/useAppUrlState";
import {
  dueLabel,
  monthName,
  periodLabel,
  shortDate,
  statusWord,
  type PackageSummary,
} from "../../lib/packageText";
import { shortName } from "../AppContext";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Money } from "../ui/Money";
import { ProgressBar } from "../ui/ProgressBar";

function urgency(p: PackageSummary, nowMs: number) {
  const done = p.status === "signed" || p.status === "exported";
  const due = p.dueDate ? dueLabel(p.dueDate, nowMs).days ?? 9999 : 9999;
  return [done ? 1 : 0, due, p.periodStart] as const;
}

export function PackagesView({ onGoData }: { onGoData: () => void }) {
  const list = useQuery(api.packages.list) as PackageSummary[] | undefined;
  const nowMs = useNowMs();

  if (list === undefined) return <PackagesSkeleton />;

  if (list.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] py-16 text-center">
        <h1 className="font-serif text-xl text-ink">
          No billing packages <em className="italic text-ink-2">yet</em>
        </h1>
        <p className="mx-auto mt-3 max-w-[52ch] text-base text-ink-2">
          A package appears for every grant and billing period once Steward has a GL detail file and a confirmed
          contract. Add them in Data.
        </p>
        <Button variant="primary" className="mt-6" onClick={onGoData}>
          Add GL detail and contracts
        </Button>
      </div>
    );
  }

  const sorted = [...list].sort((a, b) => {
    const ua = urgency(a, nowMs);
    const ub = urgency(b, nowMs);
    return ua[0] - ub[0] || ua[1] - ub[1] || ua[2].localeCompare(ub[2]);
  });
  const open = sorted.filter((p) => p.status !== "signed" && p.status !== "exported");
  const closed = sorted.filter((p) => p.status === "signed" || p.status === "exported");
  const overdue = open.filter((p) => p.dueDate && dueLabel(p.dueDate, nowMs).overdue);
  // The next deadline on the calendar, and every package due by then (overdue ones included).
  const nextDue = open
    .filter((p) => !overdue.includes(p) && p.dueDate)
    .map((p) => p.dueDate!)
    .sort()[0];
  const dueByNext = nextDue ? open.filter((p) => p.dueDate && p.dueDate <= nextDue) : overdue;
  const later = open.length - dueByNext.length;
  const thisYear = nowMs ? new Date(nowMs).getFullYear() : 0;
  const soon = !!nextDue && (dueLabel(nextDue, nowMs).days ?? 999) <= 45;
  const headCount = soon ? dueByNext.length : open.length;
  const dateText = (iso: string) => shortDate(iso, Number(iso.slice(0, 4)) !== thisYear);
  const worst = open.find((p) => p.failing.length > 0);

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="pb-8 pt-2 sm:pt-6">
        {open.length === 0 ? (
          <h1 className="font-serif text-xl text-ink text-balance sm:text-2xl">
            Every package is signed. <em className="italic text-ink-2">Nothing needs you.</em>
          </h1>
        ) : soon || overdue.length === 0 ? (
          <>
            <h1 className="font-serif text-xl text-ink text-balance sm:text-2xl">
              {headCount} {headCount === 1 ? "package needs" : "packages need"} you
              {nextDue ? (
                <>
                  {" "}
                  <em className="italic text-ink-2">{soon ? "before" : "— next due"} {dateText(nextDue)}</em>
                </>
              ) : null}
              .
            </h1>
            {(overdue.length > 0 || later > 0) && (
              <p className="mt-2 text-base">
                {overdue.length > 0 && (
                  <span className="font-medium text-redpen-ink">
                    {overdue.length} {overdue.length === 1 ? "is" : "are"} already overdue.{" "}
                  </span>
                )}
                {later > 0 && (
                  <span className="text-ink-2">
                    {later} more {later === 1 ? "is" : "are"} due later.
                  </span>
                )}
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="font-serif text-xl text-ink text-balance sm:text-2xl">
              {overdue.length} {overdue.length === 1 ? "package is" : "packages are"} overdue
              <em className="italic text-ink-2"> — oldest first.</em>
            </h1>
            {nextDue && (
              <p className="mt-2 text-base text-ink-2">
                {open.length - overdue.length} more {open.length - overdue.length === 1 ? "is" : "are"} due by {dateText(nextDue)}.
              </p>
            )}
          </>
        )}
        {worst && (
          <p className="mt-3 max-w-[64ch] text-base text-ink-2">
            {worst.failing.length === 1 ? "One failing check" : `${worst.failing.length} failing checks`} would send the{" "}
            {worst.frequency === "monthly" ? `${monthName(worst.periodStart)} ` : ""}
            {worst.program} invoice back. Steward signs nothing; a reviewer signs once every check passes.
          </p>
        )}
      </div>

      <ul className="space-y-3" aria-label="Packages that need you">
        {open.map((p) => (
          <li key={`${p.grantId}-${p.periodStart}`}>
            <PackageCard p={p} nowMs={nowMs} />
          </li>
        ))}
      </ul>

      {closed.length > 0 && (
        <section className="mt-12" aria-labelledby="signed-heading">
          <h2 id="signed-heading" className="font-serif text-lg text-ink">
            Signed <em className="italic text-ink-2">and filed</em>
          </h2>
          <ul className="mt-4 space-y-3">
            {closed.map((p) => (
              <li key={`${p.grantId}-${p.periodStart}`}>
                <PackageCard p={p} nowMs={nowMs} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PackageCard({ p, nowMs }: { p: PackageSummary; nowMs: number }) {
  const status = statusWord(p);
  const due = dueLabel(p.dueDate, nowMs);
  const done = p.status === "signed" || p.status === "exported";
  const allPass = p.checksPassed === p.checksTotal;
  const href = `/app?tab=package&id=${encodeURIComponent(packageKey(p.grantId, p.periodStart))}`;
  return (
    <Card as="article" className="group relative transition-[border-color,box-shadow] duration-150 hover:border-rule-strong hover:shadow-float">
      <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-[1fr_auto] sm:p-6">
        <div className="min-w-0">
          <h3 className="text-md font-medium text-ink">
            <Link href={href} className="after:absolute after:inset-0 after:rounded-md focus-visible:outline-none">
              {periodLabel(p.periodStart, p.periodEnd)}
              <span className="text-ink-2"> · {p.program}</span>
            </Link>
          </h3>
          <p className="mt-1 truncate text-sm text-ink-2">
            {p.funder.replace(/\s*\(fictional[^)]*\)/i, "")} · Invoice {p.invoiceNo}
          </p>
        </div>
        <div className="sm:row-span-2 sm:text-right">
          <p className="text-xs text-ink-2">{done ? "Billed" : "Claimable"}</p>
          <Money cents={p.invoiceTotalCents} focal className="text-xl font-medium tracking-[-0.02em] text-ink sm:text-2xl" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge tone={status.tone}>{status.text}</Badge>
          {!done && (
            <span className={`text-sm ${due.overdue ? "font-medium text-redpen-ink" : "text-ink-2"}`}>{due.text}</span>
          )}
          {done && p.signedAt && (
            <span className="text-sm text-ink-2">
              Signed {shortDate(p.signedAt)} by {shortName(p.reviewedBy ?? "")}
            </span>
          )}
        </div>
      </div>
      <div className="border-t border-rule px-5 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <ProgressBar
              value={p.checksPassed}
              max={p.checksTotal}
              label={`${p.checksPassed} of ${p.checksTotal} checks pass`}
              className="max-w-[200px]"
            />
            <span className={`tabular whitespace-nowrap text-sm ${allPass ? "text-green-ink" : "text-ink"}`}>
              {allPass ? `All ${p.checksTotal} checks pass` : `${p.checksPassed} of ${p.checksTotal} checks pass`}
            </span>
          </div>
          <p className="text-xs text-ink-2">
            {p.preparedBy ? `Prepared by ${shortName(p.preparedBy)}` : "Not sent for review yet"}
            {p.reviewedBy ? ` · Signed by ${shortName(p.reviewedBy)}` : ""}
          </p>
        </div>
      </div>
    </Card>
  );
}

function PackagesSkeleton() {
  return (
    <div className="mx-auto max-w-[1040px] animate-pulse" aria-busy aria-label="Loading packages">
      <div className="h-9 w-80 max-w-full rounded-sm bg-paper-2 sm:mt-6" />
      <div className="mt-4 h-4 w-96 max-w-full rounded-sm bg-paper-2" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[148px] rounded-md border border-rule bg-sheet" />
        ))}
      </div>
    </div>
  );
}
