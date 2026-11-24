/**
 * Deterministic receipt → GL line matcher. The model only reads the receipt; matching is rules.
 *
 * A receipt documents one purchase. In a GL-first workspace one purchase can be booked as several
 * split rows (same date, vendor, transaction type and Num), so the things a receipt is matched to are
 * "documents": every single line plus every multi-row split group, whose amount is the group sum.
 *
 * Matching is a global one-to-one assignment (each receipt to at most one document, each line to at
 * most one receipt), strongest evidence first:
 *   1. exact amount (cents) beats a same-vendor near amount (the difference surfaces as R-RECEIPT-MISMATCH);
 *   2. date within ±5 days beats outside the window; inside the window, vendor word overlap, then the
 *      closest date; for a near amount, the smallest difference;
 * A receipt is left unmatched with its candidates (→ R-RECEIPT-AMBIGUOUS) only when two or more free
 * documents are equally good on every criterion, e.g. the same amount on two dates equidistant from the
 * receipt date. Ties are never guessed. Human links are kept as-is and claim their lines first.
 */
import { isPayrollTxn } from "./payrollMatch";
import { vendorKey } from "./vendorKey";
import type { GrantTerms, ReceiptExtract, Txn } from "./types";

export const RECEIPT_DATE_WINDOW_DAYS = 5;

export type ReceiptInput = {
  receiptId: string;
  extracted: ReceiptExtract | null;
  matchedTxnId: string | null;
  matchedBy: "auto" | "human" | null;
};

export type ReceiptMatch = {
  matchedTxnId: string | null;
  matchScore: number | null;
  matchedBy: "auto" | "human" | null;
  candidates: string[];
  note: string;
};

const STOP = new Set(["THE", "AND", "INC", "LLC", "CO", "CORP", "STORE", "SQ", "TST", "SP"]);

export function vendorTokens(s: string | null | undefined): Set<string> {
  return new Set(vendorKey(s ?? "").split(" ").filter((w) => w.length >= 3 && !STOP.has(w)));
}

export function vendorOverlap(a: string | null | undefined, b: string | null | undefined) {
  const ta = vendorTokens(a), tb = vendorTokens(b);
  for (const w of ta) if (tb.has(w)) return true;
  return false;
}

export function daysApart(a: string, b: string) {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

/** Lines that never carry a vendor receipt: payroll (time records are the evidence), journal entries. */
export function receiptExempt(t: Txn) {
  return isPayrollTxn(t) || /journal|allocation|depreciation|accrual/i.test(t.txnType ?? "");
}

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, terms: string[]) =>
  terms.some((w) => w.trim() && new RegExp(`\\b${escapeRe(w.trim())}`, "i").test(text));

/**
 * The contract clause that exempts this line from a per-payment receipt (e.g. rent paid under the lease on file),
 * or null. Deterministic: the line's memo, description or account must name the documenting agreement
 * (documentTerms) and, when the exemption is limited to a kind of charge, that kind (costTerms).
 */
export function contractReceiptExemption(t: Txn, grant: Pick<GrantTerms, "receiptExemptions"> | undefined): { rule: string; clauseRef: string } | null {
  if (t.amountCents >= 0) return null;
  const text = `${t.description} ${t.memo} ${t.account ?? ""}`;
  for (const ex of grant?.receiptExemptions ?? []) {
    if (!ex.documentTerms?.length || !mentions(text, ex.documentTerms)) continue;
    if (ex.costTerms?.length && !mentions(text, ex.costTerms)) continue;
    return { rule: ex.rule, clauseRef: ex.clauseRef };
  }
  return null;
}

const lineVendor = (t: Txn) => `${t.vendor ?? ""} ${t.description}`;

/** Rows of one booked purchase: GL-first, same date, vendor, transaction type and document number. */
const splitKey = (t: Txn) => `${t.date}|${vendorKey(t.vendor ?? t.description)}|${(t.txnType ?? "").toLowerCase()}|${(t.docRef ?? "").trim()}`;

/** Multi-row split groups (outflow, receipt-bearing GL rows only), keyed by every member's txnId. */
export function splitGroups(txns: Txn[]): Map<string, Txn[]> {
  const byKey = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.source !== "gl" || t.amountCents >= 0 || receiptExempt(t)) continue;
    const k = splitKey(t);
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  const out = new Map<string, Txn[]>();
  for (const rows of byKey.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.txnId.localeCompare(b.txnId));
    for (const t of sorted) out.set(t.txnId, sorted);
  }
  return out;
}

export type ReceiptCoverage<R> = { receipt: R; lineIds: string[]; coveredCents: number };

/**
 * Which lines a matched receipt documents: the matched line, or its whole split group when the receipt
 * total is closer to the group sum than to the single line (the matcher links a group by its first row).
 */
export function receiptCoverage<R extends { matchedTxnId: string | null; extracted?: ReceiptExtract | null }>(
  receipts: R[], txns: Txn[],
): Map<string, ReceiptCoverage<R>> {
  const groups = splitGroups(txns);
  const byId = new Map(txns.map((t) => [t.txnId, t]));
  const out = new Map<string, ReceiptCoverage<R>>();
  for (const r of receipts) {
    if (!r.matchedTxnId) continue;
    const t = byId.get(r.matchedTxnId);
    const total = r.extracted?.totalCents ?? null;
    const group = groups.get(r.matchedTxnId);
    let rows: Txn[] = t ? [t] : [];
    if (t && group && total != null) {
      const groupSum = group.reduce((a, x) => a - x.amountCents, 0);
      if (Math.abs(total - groupSum) < Math.abs(total + t.amountCents)) rows = group;
    }
    const cov = { receipt: r, lineIds: rows.length ? rows.map((x) => x.txnId) : [r.matchedTxnId],
      coveredCents: rows.reduce((a, x) => a - x.amountCents, 0) };
    for (const id of cov.lineIds) if (!out.has(id)) out.set(id, cov);
  }
  return out;
}

type Doc = { ids: string[]; rows: Txn[]; cents: number; date: string };
type Edge = { doc: Doc; key: number[]; score: number; note: string };

/** Lexicographic compare of edge keys (higher is better at every position). */
function cmp(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function matchReceipts(receipts: ReceiptInput[], txns: Txn[]): Map<string, ReceiptMatch> {
  const out = new Map<string, ReceiptMatch>();
  const claimed = new Set<string>();
  // GL-first: receipts document GL lines only. A bank line (a placeholder for an outflow the GL lacks) is
  // never a candidate, or it ties with the GL line it pays and hides the receipt.
  const glFirst = txns.some((t) => t.source === "gl");
  const pool = txns.filter((t) => t.amountCents < 0 && !receiptExempt(t) && !(glFirst && t.source === "bank"));

  const docs: Doc[] = pool.map((t) => ({ ids: [t.txnId], rows: [t], cents: -t.amountCents, date: t.date }));
  const seenGroups = new Set<string>();
  for (const rows of splitGroups(pool).values()) {
    const k = rows.map((r) => r.txnId).join(",");
    if (seenGroups.has(k)) continue;
    seenGroups.add(k);
    docs.push({ ids: rows.map((r) => r.txnId), rows, cents: rows.reduce((a, r) => a - r.amountCents, 0), date: rows[0]!.date });
  }

  for (const r of receipts) {
    if (r.matchedBy === "human") {
      out.set(r.receiptId, { matchedTxnId: r.matchedTxnId, matchScore: r.matchedTxnId ? 1 : null, matchedBy: "human", candidates: [], note: "linked by a person" });
      if (r.matchedTxnId) claimed.add(r.matchedTxnId);
    }
  }

  const edgesByReceipt = new Map<string, Edge[]>();
  for (const r of receipts) {
    if (r.matchedBy === "human") continue;
    const x = r.extracted;
    if (!x || x.totalCents == null) {
      out.set(r.receiptId, { matchedTxnId: null, matchScore: null, matchedBy: null, candidates: [], note: "no printed total to match" });
      continue;
    }
    const edges: Edge[] = [];
    for (const doc of docs) {
      const days = x.date ? daysApart(doc.date, x.date) : 0;
      const inWindow = days <= RECEIPT_DATE_WINDOW_DAYS;
      const sameVendor = doc.rows.some((t) => vendorOverlap(x.vendor, lineVendor(t)));
      const split = doc.rows.length > 1 ? ` across ${doc.rows.length} split lines` : "";
      // Inside the window the closer date wins; outside it a date difference proves nothing.
      const dateKey = inWindow ? -days : -999;
      if (doc.cents === x.totalCents) {
        if (!inWindow && !sameVendor) continue;
        edges.push({ doc, key: [2, inWindow ? 1 : 0, sameVendor ? 1 : 0, 0, dateKey],
          score: 0.5 + (inWindow ? 0.3 : 0) + (sameVendor ? 0.2 : 0),
          note: `exact amount${split}${sameVendor ? ", vendor" : ""}, ${inWindow ? `date ${days} day(s) apart` : "date outside 5 days"}` });
      } else if (sameVendor && inWindow) {
        edges.push({ doc, key: [1, 1, 1, -Math.abs(doc.cents - x.totalCents), dateKey], score: 0.5,
          note: `same vendor within 5 days${split}, amount differs` });
      }
    }
    if (!edges.length) {
      out.set(r.receiptId, { matchedTxnId: null, matchScore: null, matchedBy: null, candidates: [], note: "no GL line matches" });
      continue;
    }
    edgesByReceipt.set(r.receiptId, edges);
  }

  const free = (d: Doc) => d.ids.every((id) => !claimed.has(id));
  const bestOf = (edges: Edge[]) => {
    const open = edges.filter((e) => free(e.doc));
    if (!open.length) return null;
    const top = open.reduce((a, e) => (cmp(e.key, a.key) > 0 ? e : a));
    return { top, tied: open.filter((e) => cmp(e.key, top.key) === 0) };
  };

  // Global greedy assignment: the strongest remaining receipt→document pair is decided first.
  const pending = new Set(edgesByReceipt.keys());
  while (pending.size) {
    let pick: { id: string; best: NonNullable<ReturnType<typeof bestOf>> } | null = null;
    for (const id of [...pending].sort()) {
      const best = bestOf(edgesByReceipt.get(id)!);
      if (!best) {
        pending.delete(id);
        out.set(id, { matchedTxnId: null, matchScore: null, matchedBy: null, candidates: [], note: "matching line already has a receipt" });
        continue;
      }
      if (!pick || cmp(best.top.key, pick.best.top.key) > 0) pick = { id, best };
    }
    if (!pick) break;
    pending.delete(pick.id);
    const { top, tied } = pick.best;
    if (tied.length === 1) {
      for (const id of top.doc.ids) claimed.add(id);
      out.set(pick.id, { matchedTxnId: top.doc.ids[0]!, matchScore: Math.round(top.score * 100) / 100, matchedBy: "auto", candidates: [], note: top.note });
    } else {
      const ids = [...new Set(tied.flatMap((e) => e.doc.ids))].sort();
      out.set(pick.id, { matchedTxnId: null, matchScore: null, matchedBy: null, candidates: ids,
        note: `tie between ${ids.join(", ")} (equally close on amount, date and vendor); a person must link it` });
    }
  }
  return out;
}
