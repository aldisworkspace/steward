/**
 * Expenditure report CSV for a signed billing package (Exhibit-B style): line detail, budget vs actual
 * (this period and cumulative), indirect, invoice total. Built only from the frozen snapshot, and the
 * printed totals are asserted to equal the snapshot to the cent.
 */
import type { BillingPackage } from "./tieOut";

const money = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const cell = (v: string | number) => {
  const s = String(v);
  // Quote everything that could break the CSV; neutralise spreadsheet formulas from vendor text.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const row = (...cells: (string | number)[]) => cells.map(cell).join(",");

export interface PackageCsvMeta {
  organization: string; invoiceNo: string; funder: string; program: string;
  preparedBy: string | null; reviewedBy: string | null; signedAt: string | null;
}

export function packageCsv(pkg: BillingPackage, meta: PackageCsvMeta): string {
  const out: string[] = [];
  out.push(row("Expenditure report", meta.organization));
  out.push(row("Grant", pkg.grantId, meta.funder, meta.program));
  out.push(row("Invoice", meta.invoiceNo, "Period", `${pkg.periodStart} to ${pkg.periodEnd}`));
  out.push(row("Prepared by", meta.preparedBy ?? "", "Reviewed by", meta.reviewedBy ?? "", "Signed", meta.signedAt ?? ""));
  out.push("");
  out.push(row("Date", "Vendor", "Description", "Doc ref", "Account", "Budget line", "Amount", "Receipt"));
  let detail = 0;
  for (const l of pkg.lines) {
    detail += l.amountCents;
    out.push(row(l.date, l.vendor, l.description, l.docRef, l.account, l.budgetLine, money(l.amountCents), l.receiptId ?? ""));
  }
  out.push(row("", "", "", "", "", "Line detail total", money(detail)));
  out.push("");
  out.push(row("Budget line", "Name", "Budget", "Prior cumulative", "This period", "Cumulative to date", "Remaining"));
  let current = 0;
  for (const r of pkg.budgetVsActual) {
    current += r.currentCents;
    out.push(row(r.code, r.name, money(r.budgetCents), money(r.priorCents), money(r.currentCents), money(r.cumulativeCents), money(r.remainingCents)));
  }
  out.push("");
  const ind = pkg.indirect;
  out.push(row("Indirect", ind.line ?? "none", "Base", ind.base ?? "", money(ind.baseCents), "Rate (bps)", ind.rateBps ?? "", "Computed", money(ind.computedCents), "Claimed", money(ind.claimedCents)));
  out.push("");
  if (pkg.excluded.length) {
    out.push(row("Excluded from this invoice", "Vendor", "Description", "Claimed line", "Amount", "Reason"));
    for (const x of pkg.excluded) out.push(row(x.date, x.vendor, x.description, x.claimedBudgetLine ?? "", money(x.amountCents), x.reason));
    out.push("");
  }
  out.push(row("Invoice total", money(pkg.invoiceTotalCents)));

  // A one-cent difference returns the whole invoice: never emit a report that doesn't tie.
  if (detail !== pkg.invoiceTotalCents || current !== pkg.invoiceTotalCents) {
    throw new Error(`Export does not tie: detail ${detail}, budget-vs-actual ${current}, invoice ${pkg.invoiceTotalCents} (cents)`);
  }
  if (ind.line && (pkg.totalsByBudgetLine[ind.line] ?? 0) !== ind.claimedCents) {
    throw new Error("Export does not tie: indirect line differs from the claimed indirect");
  }
  return out.join("\r\n") + "\r\n";
}
