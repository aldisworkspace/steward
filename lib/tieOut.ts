/**
 * Billing package + penny tie-outs. Pure (no I/O): the same function backs the live package view,
 * the signed snapshot and the CSV export. All money is integer cents.
 *
 * Sign convention inside a package: positive = cost billed to the funder (GL outflows are negative,
 * so a line's cost is -amountCents; a refund credited to the grant is a negative cost).
 */
import { issueLabel } from "./issueLabel";
import { isPayrollTxn } from "./payrollMatch";
import { receiptCoverage } from "./matchReceipts";
import type { GrantTerms, ReceiptExtract, Txn } from "./types";

export const DEFAULT_RECEIPT_THRESHOLD = 75_00;

export type Resolution = "acknowledged" | "overridden" | "approved_entry" | "rejected_entry";

export interface TieOutDecision {
  txnId: string;
  grantId: string | null;
  budgetLine: string | null;
  splits?: { grantId: string | null; budgetLine: string | null; amount: number }[];
  status: "auto" | "needs_review" | "blocked";
  ruleHits: string[];
  checks?: { label: string; message: string }[];
  rationale?: string;
}
export interface TieOutResolution { txnId: string; resolution: Resolution; by: string }
export interface TieOutReceipt { receiptId: string; fileName?: string; matchedTxnId: string | null;
  /** Extracted receipt (total) lets one receipt document a whole split group of GL rows. */
  extracted?: ReceiptExtract | null }
export interface PriorPackage {
  periodStart: string; periodEnd: string;
  status: "draft" | "ready_for_review" | "signed" | "exported";
  totalsByBudgetLine: Record<string, number>;
}

export interface PackageLine {
  txnId: string; date: string; vendor: string; description: string; docRef: string; account: string;
  budgetLine: string; amountCents: number; receiptId: string | null; programApprovedBy: string | null;
  resolvedBy: string | null; status: TieOutDecision["status"] | "unreviewed";
}
export interface ExcludedLine {
  txnId: string; date: string; vendor: string; description: string; claimedBudgetLine: string | null;
  amountCents: number; reason: string;
}
export interface TieOutCheck {
  id: "SUM_TIES" | "INDIRECT_ROUNDING" | "CUMULATIVE_WITHIN_BUDGET" | "IN_PERIOD" | "RECEIPTS" | "NO_OPEN_EXCEPTIONS" | "PROGRAM_APPROVAL";
  label: string; pass: boolean; detail: string; numbers: Record<string, number>;
}
export interface BudgetVsActualRow {
  code: string; name: string; budgetCents: number; capCents: number;
  priorCents: number; currentCents: number; cumulativeCents: number; remainingCents: number;
}
export interface BillingPackage {
  grantId: string; periodStart: string; periodEnd: string;
  lines: PackageLine[];
  excluded: ExcludedLine[];
  totalsByBudgetLine: Record<string, number>;
  budgetVsActual: BudgetVsActualRow[];
  indirect: { line: string | null; base: "salaries" | "direct" | "mtdc" | null; baseCents: number; rateBps: number | null; computedCents: number; claimedCents: number };
  glTotalCents: number;
  invoiceTotalCents: number;
  checks: TieOutCheck[];
  allPass: boolean;
}

export interface BuildPackageInput {
  grant: GrantTerms;
  periodStart: string;
  periodEnd: string;
  /** All GL lines of the workspace; the package selects this grant's lines in the period. */
  lines: Txn[];
  decisions: TieOutDecision[];
  receipts: TieOutReceipt[];
  resolutions: TieOutResolution[];
  priorPackages: PriorPackage[];
  receiptThresholdCents?: number;
}

type Portion = { grantId: string | null; budgetLine: string | null; amount: number };

/**
 * How a line is coded after human review. A person overriding Steward (or rejecting its correcting
 * entry) keeps the bookkeeper's coding; otherwise Steward's verified decision stands (an acknowledged
 * or approved correction moves the money). No decision yet → the bookkeeper's coding.
 */
export function effectivePortions(t: Txn, d: TieOutDecision | undefined, r: TieOutResolution | undefined): Portion[] {
  const claim: Portion[] = [{ grantId: t.glClass ?? null, budgetLine: t.glBudgetLine ?? null, amount: t.amountCents }];
  if (r && (r.resolution === "overridden" || r.resolution === "rejected_entry")) return claim;
  if (!d) return claim;
  return d.splits?.length ? d.splits : [{ grantId: d.grantId, budgetLine: d.budgetLine, amount: t.amountCents }];
}

const INDIRECT_LINE = /indirect|overhead|f&a|facilities (and|&) admin/i;
const SALARY_LINE = /personnel|salar|wage/i;
const NOT_SALARY = /fringe|benefit/i;
const NOT_MTDC = /equipment|rent|occupancy|participant|stipend|subaward|tuition|capital/i;

export function indirectLineCode(grant: GrantTerms): string | null {
  return grant.budgetLines.find((l) => INDIRECT_LINE.test(l.name) || INDIRECT_LINE.test(l.code))?.code ?? null;
}

export function baseLineCodes(grant: GrantTerms, base: "salaries" | "direct" | "mtdc", indirect: string | null) {
  return grant.budgetLines.filter((l) => {
    if (l.code === indirect) return false;
    if (base === "salaries") return SALARY_LINE.test(l.name) && !NOT_SALARY.test(l.name);
    if (base === "mtdc") return !NOT_MTDC.test(l.name);
    return true;
  }).map((l) => l.code);
}

/** Integer-only rate application: round(base × rateBps / 10000), one-half cent rounds up. */
export function applyRate(baseCents: number, rateBps: number): number {
  return Math.round((baseCents * rateBps) / 10000);
}

const usd = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const receiptExempt = (t: Txn) => isPayrollTxn(t) || /journal|allocation|depreciation|accrual/i.test(t.txnType ?? "");

export function buildPackage(input: BuildPackageInput): BillingPackage {
  const { grant, periodStart, periodEnd } = input;
  const threshold = input.receiptThresholdCents ?? DEFAULT_RECEIPT_THRESHOLD;
  const gid = grant.grantId;
  const dById = new Map(input.decisions.map((d) => [d.txnId, d]));
  const rById = new Map(input.resolutions.map((r) => [r.txnId, r]));
  const receiptByTxn = new Map<string, TieOutReceipt>();
  // A receipt documents its matched line, or the whole split group it was matched to (see receiptCoverage).
  for (const [lineId, cov] of receiptCoverage(input.receipts, input.lines)) receiptByTxn.set(lineId, cov.receipt);
  const glFirst = input.lines.some((t) => t.source === "gl");

  const lines: PackageLine[] = [];
  const excluded: ExcludedLine[] = [];
  const totals: Record<string, number> = Object.fromEntries(grant.budgetLines.map((l) => [l.code, 0]));
  let glTotal = 0, excludedTotal = 0, movedOn = 0;
  const splitErrors: string[] = [];
  const open: string[] = [];
  const selected: Txn[] = [];

  for (const t of input.lines) {
    if (glFirst && t.source === "bank") continue; // not in the books yet
    if (t.date < periodStart || t.date > periodEnd) continue;
    const d = dById.get(t.txnId);
    const r = rById.get(t.txnId);
    const portions = effectivePortions(t, d, r);
    const claimed = (t.glClass ?? null) === gid;
    const mine = portions.filter((p) => p.grantId === gid);
    if (!claimed && !mine.length) continue;
    selected.push(t);
    if (portions.reduce((a, p) => a + p.amount, 0) !== t.amountCents) splitErrors.push(t.txnId);

    const cost = -t.amountCents;
    if (claimed) glTotal += cost;
    if (d && d.status !== "auto" && !r) open.push(t.txnId);
    if (!d) open.push(t.txnId);

    for (const p of mine) {
      const amountCents = -p.amount;
      if (!claimed) movedOn += amountCents;
      const code = p.budgetLine ?? "?";
      totals[code] = (totals[code] ?? 0) + amountCents;
      lines.push({
        txnId: t.txnId, date: t.date, vendor: t.vendor ?? t.description, description: t.memo || t.description,
        docRef: t.docRef ?? "", account: t.account ?? "", budgetLine: code, amountCents,
        receiptId: receiptByTxn.get(t.txnId)?.receiptId ?? null, programApprovedBy: t.programApprovedBy ?? null,
        resolvedBy: r?.by ?? null, status: d?.status ?? "unreviewed",
      });
    }
    if (claimed) {
      const off = portions.filter((p) => p.grantId !== gid).reduce((a, p) => a - p.amount, 0);
      if (off) {
        excludedTotal += off;
        const why = d?.checks?.[0]?.message || (d?.ruleHits[0] ? issueLabel(d.ruleHits[0], d.status) : "") || d?.rationale || "moved off this grant";
        excluded.push({ txnId: t.txnId, date: t.date, vendor: t.vendor ?? t.description, description: t.memo || t.description,
          claimedBudgetLine: t.glBudgetLine ?? null, amountCents: off, reason: why });
      }
    }
  }
  lines.sort((a, b) => a.budgetLine.localeCompare(b.budgetLine) || a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId));

  const checks: TieOutCheck[] = [];
  const detail = lines.reduce((a, l) => a + l.amountCents, 0);
  const invoice = Object.values(totals).reduce((a, c) => a + c, 0);
  const expected = glTotal - excludedTotal + movedOn;
  const sumPass = detail === invoice && expected === invoice && splitErrors.length === 0;
  checks.push({ id: "SUM_TIES", label: "Invoice = expenditure report = GL", pass: sumPass,
    detail: sumPass
      ? `Line detail, invoice and GL all tie at ${usd(invoice)} (GL ${usd(glTotal)} − excluded ${usd(excludedTotal)} + moved on ${usd(movedOn)}).`
      : [detail !== invoice ? `line detail ${usd(detail)} ≠ invoice ${usd(invoice)}` : null,
         expected !== invoice ? `GL ${usd(glTotal)} − excluded ${usd(excludedTotal)} + moved on ${usd(movedOn)} = ${usd(expected)} ≠ invoice ${usd(invoice)} (off by ${usd(invoice - expected)})` : null,
         splitErrors.length ? `split amounts don't add up to the GL line on ${splitErrors.join(", ")}` : null].filter(Boolean).join("; "),
    numbers: { detailCents: detail, invoiceTotalCents: invoice, glTotalCents: glTotal, excludedCents: excludedTotal, movedOnCents: movedOn, splitErrors: splitErrors.length } });

  // Indirect: computed once on the stated base, compared to what is claimed on the indirect line.
  const indirectCode = indirectLineCode(grant);
  const claimedIndirect = indirectCode ? (totals[indirectCode] ?? 0) : 0;
  const pct = grant.indirectCapPct;
  const base = grant.indirectBase ?? null;
  const effBase = base ?? "direct";
  const rateBps = pct == null ? null : Math.round(pct * 100);
  const baseCodes = baseLineCodes(grant, effBase, indirectCode);
  const baseCents = baseCodes.reduce((a, c) => a + (totals[c] ?? 0), 0);
  const computed = rateBps == null ? 0 : applyRate(baseCents, rateBps);
  const mustEqual = base != null || grant.billing?.costBasis === "reimbursement";
  let indirectPass: boolean, indirectDetail: string;
  if (rateBps == null) {
    indirectPass = claimedIndirect === 0;
    indirectDetail = indirectPass ? "No indirect rate in the terms and none claimed." : `${usd(claimedIndirect)} indirect claimed but the terms state no indirect rate.`;
  } else if (mustEqual) {
    indirectPass = computed === claimedIndirect;
    indirectDetail = `${pct}% × ${effBase} base ${usd(baseCents)} (lines ${baseCodes.join(", ") || "none"}) = ${usd(computed)}; claimed on ${indirectCode ?? "no indirect line"} ${usd(claimedIndirect)}${indirectPass ? "." : ` — off by ${usd(claimedIndirect - computed)}.`}`;
  } else {
    indirectPass = claimedIndirect <= computed;
    indirectDetail = `Cap ${pct}% × direct ${usd(baseCents)} = ${usd(computed)}; claimed ${usd(claimedIndirect)}${indirectPass ? " (within the cap)." : " — over the cap."}`;
  }
  checks.push({ id: "INDIRECT_ROUNDING", label: "Indirect computed once, to the cent", pass: indirectPass, detail: indirectDetail,
    numbers: { baseCents, rateBps: rateBps ?? 0, computedCents: computed, claimedCents: claimedIndirect } });

  // Cumulative vs budget (prior signed/exported packages + this one).
  const priors = input.priorPackages.filter((p) => (p.status === "signed" || p.status === "exported") && p.periodEnd < periodStart);
  const variance = grant.lineVarianceLimitPct ?? 0;
  const bva: BudgetVsActualRow[] = grant.budgetLines.map((l) => {
    const budgetCents = Math.round(l.amount * 100);
    const capCents = Math.round(budgetCents * (100 + variance) / 100);
    const priorCents = priors.reduce((a, p) => a + (p.totalsByBudgetLine[l.code] ?? 0), 0);
    const currentCents = totals[l.code] ?? 0;
    const cumulativeCents = priorCents + currentCents;
    return { code: l.code, name: l.name, budgetCents, capCents, priorCents, currentCents, cumulativeCents, remainingCents: budgetCents - cumulativeCents };
  });
  const over = bva.filter((r) => r.cumulativeCents > r.capCents);
  const unknownLines = Object.keys(totals).filter((c) => !grant.budgetLines.some((l) => l.code === c) && totals[c]);
  const awardCents = Math.round(grant.totalAward * 100);
  const cumulativeAll = bva.reduce((a, r) => a + r.cumulativeCents, 0) + unknownLines.reduce((a, c) => a + totals[c]!, 0);
  const cumPass = !over.length && !unknownLines.length && cumulativeAll <= awardCents;
  checks.push({ id: "CUMULATIVE_WITHIN_BUDGET", label: "Cumulative within budget", pass: cumPass,
    detail: cumPass
      ? `All lines within budget${variance ? ` + ${variance}% variance` : ""}; cumulative ${usd(cumulativeAll)} of ${usd(awardCents)}.`
      : [...over.map((r) => `${r.code} cumulative ${usd(r.cumulativeCents)} > cap ${usd(r.capCents)}`),
         ...unknownLines.map((c) => `${usd(totals[c]!)} on budget line "${c}" that is not in the grant`),
         cumulativeAll > awardCents ? `cumulative ${usd(cumulativeAll)} > award ${usd(awardCents)}` : null].filter(Boolean).join("; "),
    numbers: { cumulativeCents: cumulativeAll, awardCents, linesOver: over.length } });

  const outOfPeriod = lines.filter((l) => l.date < periodStart || l.date > periodEnd || l.date < grant.periodStart || l.date > grant.periodEnd);
  const periodOutsideGrant = periodStart < grant.periodStart || periodEnd > grant.periodEnd;
  checks.push({ id: "IN_PERIOD", label: "Every charge in the billing and grant period", pass: !outOfPeriod.length,
    detail: outOfPeriod.length
      ? `Outside ${gid}'s period (${grant.periodStart} to ${grant.periodEnd}): ${[...new Set(outOfPeriod.map((l) => `${l.txnId} ${l.date}`))].join(", ")}.`
      : `All charges dated ${periodStart} to ${periodEnd}${periodOutsideGrant ? `, inside the grant period ${grant.periodStart} to ${grant.periodEnd}` : ""}.`,
    numbers: { outOfPeriod: outOfPeriod.length } });

  const txnById = new Map(selected.map((t) => [t.txnId, t]));
  const needReceipt = [...new Set(lines.map((l) => l.txnId))].filter((id) => {
    const t = txnById.get(id)!;
    return -t.amountCents >= threshold && !receiptExempt(t) && !receiptByTxn.has(id);
  });
  checks.push({ id: "RECEIPTS", label: `Receipts for every non-payroll charge ≥ ${usd(threshold)}`, pass: !needReceipt.length,
    detail: needReceipt.length ? `No matched receipt: ${needReceipt.join(", ")}.` : "Every charge at or above the threshold has a matched receipt.",
    numbers: { missing: needReceipt.length, thresholdCents: threshold } });

  const openIds = [...new Set(open)];
  checks.push({ id: "NO_OPEN_EXCEPTIONS", label: "No open exceptions", pass: !openIds.length,
    detail: openIds.length ? `Still open (needs review / not allowed / not reviewed): ${openIds.join(", ")}.` : "Every flagged line has been resolved by a person.",
    numbers: { open: openIds.length } });

  const unapproved = [...new Set(lines.filter((l) => !l.programApprovedBy && !l.resolvedBy).map((l) => l.txnId))];
  checks.push({ id: "PROGRAM_APPROVAL", label: "Program approval on every line", pass: !unapproved.length,
    detail: unapproved.length ? `No program approval or resolution: ${unapproved.length} line(s) (${unapproved.slice(0, 8).join(", ")}${unapproved.length > 8 ? ", …" : ""}).` : "Every line is approved by the program or resolved by a reviewer.",
    numbers: { unapproved: unapproved.length } });

  return {
    grantId: gid, periodStart, periodEnd, lines, excluded, totalsByBudgetLine: totals, budgetVsActual: bva,
    indirect: { line: indirectCode, base, baseCents, rateBps, computedCents: computed, claimedCents: claimedIndirect },
    glTotalCents: glTotal, invoiceTotalCents: invoice, checks, allPass: checks.every((c) => c.pass),
  };
}

/** Legacy bank-first rows keep the bookkeeper's coding in glRows; copy it onto the line when missing. */
export function withGlClaims<T extends Txn>(txns: T[], glRows: { bankRef: string; class: string | null; budgetLine: string | null }[]): T[] {
  const gl = new Map(glRows.map((g) => [g.bankRef, g]));
  return txns.map((t) => (t.glClass !== undefined || !gl.has(t.txnId) ? t : { ...t, glClass: gl.get(t.txnId)!.class, glBudgetLine: gl.get(t.txnId)!.budgetLine }));
}

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};
const addMonths = (iso: string, n: number) => {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

/** Billing periods from the terms, clipped to the grant period and to the last date with data. */
export function billingPeriods(grant: GrantTerms, lastDataDate: string | null): { periodStart: string; periodEnd: string }[] {
  if (!lastDataDate || lastDataDate < grant.periodStart) return [];
  const freq = grant.billing?.frequency ?? "none";
  if (freq === "none") return [{ periodStart: grant.periodStart, periodEnd: grant.periodEnd }];
  const months = freq === "monthly" ? 1 : 3;
  const out: { periodStart: string; periodEnd: string }[] = [];
  let start = grant.periodStart;
  for (let i = 0; i < 120 && start <= grant.periodEnd && start <= lastDataDate; i++) {
    const nextFirst = addMonths(start.slice(0, 7) + "-01", months);
    const end = monthEnd(addMonths(nextFirst, -1).slice(0, 7));
    out.push({ periodStart: start, periodEnd: end < grant.periodEnd ? end : grant.periodEnd });
    start = nextFirst;
  }
  return out;
}

export const defaultInvoiceNo = (grantId: string, periodStart: string) => `${grantId}-${periodStart.slice(0, 7)}`;
