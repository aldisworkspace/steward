import { displayVendor } from "./displayVendor";

export type NarrativeTxn = {
  date: string;
  description: string;
  amountCents: number;
  memo?: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-21" -> "Aug 21, 2026" without going through Date (no timezone drift). */
export function fmtNarrativeDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/** Readable, short vendor name: title-case ALL-CAPS bank strings, keep mixed-case names as written. */
export function narrativeVendor(raw: string): string {
  const trimmed = raw.trim();
  const pretty = /[a-z]/.test(trimmed) ? trimmed : displayVendor(trimmed);
  const words = pretty.split(/\s+/).filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > 32 && out) break;
    out = next;
  }
  return out || "The vendor";
}

function usd(cents: number): string {
  return `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** e.g. `The Black Cat SF charged $482.50 on Aug 21, 2026 for "Staff appreciation night - YPE team".` */
export function bankSentence(txn: NarrativeTxn): string {
  const vendor = narrativeVendor(txn.description);
  const date = fmtNarrativeDate(txn.date);
  const memo = (txn.memo ?? "").trim().replace(/[.\s]+$/, "");
  const forMemo = memo ? ` for "${memo}"` : "";
  if (txn.amountCents > 0) return `${vendor} paid in ${usd(txn.amountCents)} on ${date}${forMemo}.`;
  return `${vendor} charged ${usd(txn.amountCents)} on ${date}${forMemo}.`;
}

export function caseNarrative(args: {
  txn?: NarrativeTxn;
  hasGl?: boolean;
  bkLabel: string | null;
  stewardLabel: string;
  status: string;
  actionHint: string;
}): { happened: string; stewardDid: string; youNeed: string } {
  const sentence = args.txn ? bankSentence(args.txn) : null;
  const happened = sentence
    ? args.hasGl
      ? `${sentence} Bookkeeper coded it as ${args.bkLabel ?? "unknown"}.`
      : sentence
    : "Bank and ledger facts are on file for this charge.";
  const stewardDid =
    args.bkLabel && args.stewardLabel !== args.bkLabel
      ? `Steward would code ${args.stewardLabel} instead of the bookkeeper's ${args.bkLabel}.`
      : `Steward's coding: ${args.stewardLabel}.`;
  const youNeed =
    args.status === "blocked"
      ? "Confirm moving this off grant funds or override with a documented reason."
      : args.actionHint;
  return { happened, stewardDid, youNeed };
}
