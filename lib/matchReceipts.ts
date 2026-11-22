/**
 * Deterministic receipt → GL line matcher. The model only reads the receipt; matching is rules:
 *   1. exact amount (cents), 2. date within ±5 days, 3. vendor word overlap (lib/vendorKey.ts).
 * If no line has the exact amount, a single same-vendor line within the date window is matched so
 * the amount difference surfaces as R-RECEIPT-MISMATCH. Ties are never guessed: the receipt stays
 * unmatched and its candidate lines go to needs_review. Human links are kept as-is.
 */
import { vendorKey } from "./vendorKey";
import type { ReceiptExtract, Txn } from "./types";

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

const lineVendor = (t: Txn) => `${t.vendor ?? ""} ${t.description}`;

export function matchReceipts(receipts: ReceiptInput[], txns: Txn[]): Map<string, ReceiptMatch> {
  const out = new Map<string, ReceiptMatch>();
  const claimed = new Set<string>();
  const pool = txns.filter((t) => t.amountCents < 0);

  for (const r of receipts) {
    if (r.matchedBy === "human") {
      out.set(r.receiptId, { matchedTxnId: r.matchedTxnId, matchScore: r.matchedTxnId ? 1 : null, matchedBy: "human", candidates: [], note: "linked by a person" });
      if (r.matchedTxnId) claimed.add(r.matchedTxnId);
    }
  }

  type Proposal = { r: ReceiptInput; strength: number; cands: Txn[]; score: number; note: string };
  const proposals: Proposal[] = [];
  for (const r of receipts) {
    if (r.matchedBy === "human") continue;
    const x = r.extracted;
    if (!x || x.totalCents == null) {
      out.set(r.receiptId, { matchedTxnId: null, matchScore: null, matchedBy: null, candidates: [], note: "no printed total to match" });
      continue;
    }
    const inWindow = (t: Txn) => !x.date || daysApart(t.date, x.date) <= RECEIPT_DATE_WINDOW_DAYS;
    const sameVendor = (t: Txn) => vendorOverlap(x.vendor, lineVendor(t));
    const exact = pool.filter((t) => -t.amountCents === x.totalCents);
    if (exact.length) {
      let cands = exact.filter(inWindow);
      let note = "exact amount, date within 5 days";
      if (!cands.length) { cands = exact.filter(sameVendor); note = "exact amount and vendor, date outside 5 days"; }
      if (cands.length > 1) {
        const v = cands.filter(sameVendor);
        if (v.length) { cands = v; note += ", vendor"; }
      }
      const score = 0.5 + (cands.every(inWindow) ? 0.3 : 0) + (cands.every(sameVendor) ? 0.2 : 0);
      proposals.push({ r, strength: 2, cands, score, note });
      continue;
    }
    const near = pool.filter((t) => sameVendor(t) && inWindow(t));
    proposals.push({ r, strength: 1, cands: near, score: 0.5, note: "same vendor within 5 days, amount differs" });
  }

  // Exact-amount proposals claim lines before vendor-only ones.
  proposals.sort((a, b) => b.strength - a.strength);
  for (const p of proposals) {
    const free = p.cands.filter((t) => !claimed.has(t.txnId));
    if (free.length === 1) {
      claimed.add(free[0]!.txnId);
      out.set(p.r.receiptId, { matchedTxnId: free[0]!.txnId, matchScore: Math.round(p.score * 100) / 100, matchedBy: "auto", candidates: [], note: p.note });
    } else if (free.length > 1) {
      out.set(p.r.receiptId, { matchedTxnId: null, matchScore: null, matchedBy: null, candidates: free.map((t) => t.txnId),
        note: `tie between ${free.map((t) => t.txnId).join(", ")}; a person must link it` });
    } else {
      out.set(p.r.receiptId, { matchedTxnId: null, matchScore: null, matchedBy: null, candidates: [],
        note: p.cands.length ? "matching line already has a receipt" : "no GL line matches" });
    }
  }
  return out;
}
