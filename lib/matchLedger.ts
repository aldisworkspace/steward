import type { BankLine, GlRow, Txn } from "./types";
import { isPayrollTxn } from "./payrollMatch";

function daysBetween(a: string, b: string) {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export const MATCH_WINDOW_DAYS = 3;

export function tokenOverlap(a: string, b: string) {
  const ta = new Set(a.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const tb = new Set(b.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
  let n = 0;
  for (const w of ta) if (tb.has(w)) n++;
  return n;
}

export type LedgerCsvRow = {
  date: string;
  description: string;
  amountCents: number;
  account: string;
  class: string | null;
  budgetLine: string | null;
  enteredBy: string;
};

export function matchLedgerToBank(
  ledgerRows: LedgerCsvRow[],
  txns: Txn[],
): { gl: GlRow[]; orphanFindings: { description: string; date: string; amountCents: number }[] } {
  const used = new Set<string>();
  const gl: GlRow[] = [];

  for (const row of ledgerRows) {
    let best: Txn | null = null;
    let bestScore = -1;
    for (const t of txns) {
      if (used.has(t.txnId)) continue;
      if (t.amountCents !== row.amountCents) continue;
      const dd = daysBetween(t.date, row.date);
      if (dd > MATCH_WINDOW_DAYS) continue;
      const score = matchScore(dd, t.description, row.description);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      used.add(best.txnId);
      gl.push({
        bankRef: best.txnId,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        account: row.account,
        class: row.class,
        budgetLine: row.budgetLine,
        enteredBy: row.enteredBy,
      });
    }
  }

  const orphanFindings = ledgerRows
    .filter((row) => {
      const matched = gl.some(
        (g) => g.amountCents === row.amountCents && g.date === row.date && g.description === row.description,
      );
      return !matched;
    })
    .map((row) => ({
      description: row.description,
      date: row.date,
      amountCents: row.amountCents,
    }));

  return { gl, orphanFindings };
}

/** Same scoring for both directions: closer date and more shared vendor words win. */
export function matchScore(days: number, a: string, b: string) {
  return 10 - days + tokenOverlap(a, b) * 3;
}

export type ReconMatch = {
  bankLineId: string;
  /** exact: same amount; group: several GL lines of one payment sum to the bank amount; near: same vendor/date, amounts differ. */
  tier: "exact" | "group" | "near";
  bankAmountCents: number;
  /** For group matches, the GL lines that together make up the bank amount. */
  groupTxnIds?: string[];
};

export type Reconciliation = {
  matches: Map<string, ReconMatch>;
  /** Bank outflows with no GL line. */
  unrecorded: BankLine[];
  statementStart: string | null;
  statementEnd: string | null;
};

/** GL lines that never hit the bank as a single payment: journal entries, bills (paid later), card charges. */
export const NON_CASH_TYPE = /journal|bill(?!\s*payment)|credit card|accrual|allocation|depreciation|paycheck|payroll/i;

const textOf = (t: { description: string; memo: string; vendor?: string; docRef?: string }) =>
  `${t.vendor ?? ""} ${t.description} ${t.memo} ${t.docRef ?? ""}`;

/**
 * Optional bank reconciliation for GL-first workspaces (the GL is the primary record).
 * Reuses the ledger matcher's rule: exact amount, within ±3 days, best vendor-word overlap.
 * Then: several GL lines of one payment (same date + document/vendor) summing to one bank line,
 * then a "near" match (same vendor words, ±3 days, amounts differ) so a typo shows as a mismatch.
 */
export function reconcileGlToBank(glLines: Txn[], bank: BankLine[]): Reconciliation {
  const matches = new Map<string, ReconMatch>();
  const usedBank = new Set<string>();
  const dates = bank.map((b) => b.date).sort();
  const statementStart = dates[0] ?? null;
  const statementEnd = dates[dates.length - 1] ?? null;

  const best = (amount: number | null, date: string, text: string, needOverlap: boolean) => {
    let hit: BankLine | null = null, hitScore = -Infinity;
    for (const b of bank) {
      if (usedBank.has(b.lineId)) continue;
      if (amount !== null && b.amountCents !== amount) continue;
      const dd = daysBetween(b.date, date);
      if (dd > MATCH_WINDOW_DAYS) continue;
      const overlap = tokenOverlap(`${b.description} ${b.memo}`, text);
      if (needOverlap && overlap < 1) continue;
      const score = matchScore(dd, `${b.description} ${b.memo}`, text);
      if (score > hitScore) { hitScore = score; hit = b; }
    }
    return hit;
  };

  // Bills post on the invoice date and reach the bank later as a check (tier 3), never same-day.
  const isBill = (t: Txn) => /\bbill\b/i.test(t.txnType ?? "") && !/payment/i.test(t.txnType ?? "");

  // 1. exact amount
  for (const t of glLines) {
    if (isBill(t)) continue;
    const b = best(t.amountCents, t.date, textOf(t), false);
    if (!b) continue;
    usedBank.add(b.lineId);
    matches.set(t.txnId, { bankLineId: b.lineId, tier: "exact", bankAmountCents: b.amountCents });
  }

  // 2. split payments: GL lines sharing date + document number (or vendor) that sum to one bank line;
  //    payroll: all paycheck lines of one pay date sum to the payroll ACH.
  const groups = new Map<string, Txn[]>();
  for (const t of glLines) {
    if (matches.has(t.txnId) || isBill(t)) continue;
    const isPaycheck = /paycheck/i.test(t.txnType ?? "") || (isPayrollTxn(t) && !/journal|accrual|allocation/i.test(t.txnType ?? ""));
    const key = isPaycheck ? `PAYROLL|${t.date}` : `${t.date}|${(t.docRef || t.vendor || t.description).trim().toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sum = members.reduce((a, t) => a + t.amountCents, 0);
    const b = best(sum, members[0]!.date, textOf(members[0]!), false);
    if (!b) continue;
    usedBank.add(b.lineId);
    for (const t of members) {
      matches.set(t.txnId, { bankLineId: b.lineId, tier: "group", bankAmountCents: b.amountCents, groupTxnIds: members.map((m) => m.txnId) });
    }
  }

  // 3. checks clear later: a bank "CHECK nnnn" pays a Bill or Check line (or one bill's lines) dated up
  //    to 45 days before it, same amount; the closest earlier date wins.
  const CLEAR_DAYS = 45;
  for (const b of bank) {
    if (usedBank.has(b.lineId) || b.amountCents >= 0 || !/\bCHECK\b|\bCHK\b/i.test(b.description)) continue;
    const open = glLines.filter((t) => !matches.has(t.txnId) && /bill|check/i.test(t.txnType ?? "") && t.date <= b.date &&
      daysBetween(t.date, b.date) <= CLEAR_DAYS);
    const byDoc = new Map<string, Txn[]>();
    for (const t of open) if (t.docRef) byDoc.set(`${t.vendor}|${t.docRef}`, [...(byDoc.get(`${t.vendor}|${t.docRef}`) ?? []), t]);
    // A multi-line bill is paid as a whole. A single line of a multi-line document only counts when the
    // document repeats that same amount (the same invoice entered twice: the bank paid it once).
    const whole: Txn[][] = [...byDoc.values()].filter((g) => g.length > 1 && g.reduce((a, t) => a + t.amountCents, 0) === b.amountCents);
    const singles = open.filter((t) => {
      if (t.amountCents !== b.amountCents) return false;
      const doc = byDoc.get(`${t.vendor}|${t.docRef}`) ?? [t];
      return doc.length <= 1 || doc.filter((x) => x.amountCents === t.amountCents).length > 1;
    });
    const options: Txn[][] = [...singles.map((t) => [t]), ...whole];
    if (!options.length) continue;
    options.sort((x, y) => daysBetween(x[0]!.date, b.date) - daysBetween(y[0]!.date, b.date));
    usedBank.add(b.lineId);
    const members = options[0]!;
    for (const t of members) {
      matches.set(t.txnId, { bankLineId: b.lineId, tier: members.length > 1 ? "group" : "exact", bankAmountCents: b.amountCents,
        ...(members.length > 1 ? { groupTxnIds: members.map((m) => m.txnId) } : {}) });
    }
  }

  // 4. near match: same vendor words and date window, different amount (same direction)
  for (const t of glLines) {
    if (matches.has(t.txnId) || NON_CASH_TYPE.test(t.txnType ?? "") || isPayrollTxn(t)) continue;
    const b = best(null, t.date, textOf(t), true);
    if (!b || Math.sign(b.amountCents) !== Math.sign(t.amountCents)) continue;
    usedBank.add(b.lineId);
    matches.set(t.txnId, { bankLineId: b.lineId, tier: "near", bankAmountCents: b.amountCents });
  }

  const unrecorded = bank.filter((b) => b.amountCents < 0 && !usedBank.has(b.lineId));
  return { matches, unrecorded, statementStart, statementEnd };
}

export function suggestLedgerMapping(headers: string[]) {
  const norm = (h: string) => h.trim().toLowerCase();
  const pick = (syns: string[]) => headers.find((h) => syns.some((s) => norm(h).includes(s))) ?? null;
  return {
    date: pick(["date", "posting"]),
    description: pick(["description", "name", "payee", "memo"]),
    amount: pick(["amount", "net"]),
    class: pick(["class", "fund", "grant"]),
    account: pick(["account", "split"]),
    budgetLine: pick(["budget", "line", "program"]),
    enteredBy: pick(["entered", "user", "by"]),
  };
}
