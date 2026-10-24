import { parseCsv } from "./parse";
import type { Txn } from "./types";

export type BankColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "memo" | "skip";

export type BankColumnMapping = Record<BankColumnRole, string | null>;

const DATE_SYNONYMS = ["date", "posting date", "transaction date", "posted", "post date"];
const DESC_SYNONYMS = ["description", "payee", "name", "merchant", "details", "vendor"];
const AMOUNT_SYNONYMS = ["amount", "transaction amount", "net amount"];
const DEBIT_SYNONYMS = ["debit", "withdrawal", "withdrawals", "money out"];
const CREDIT_SYNONYMS = ["credit", "deposit", "deposits", "money in"];
const MEMO_SYNONYMS = ["memo", "notes", "note", "category", "reference", "ref"];

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function pickColumn(headers: string[], synonyms: string[]): string | null {
  const normed = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  for (const syn of synonyms) {
    const hit = normed.find((h) => h.n === syn || h.n.includes(syn));
    if (hit) return hit.raw;
  }
  return null;
}

export function suggestBankMapping(headers: string[]): BankColumnMapping {
  const debit = pickColumn(headers, DEBIT_SYNONYMS);
  const credit = pickColumn(headers, CREDIT_SYNONYMS);
  const amount =
    pickColumn(headers, AMOUNT_SYNONYMS) ??
    (debit || credit ? null : null);
  return {
    date: pickColumn(headers, DATE_SYNONYMS),
    description: pickColumn(headers, DESC_SYNONYMS),
    amount: debit && credit ? null : amount,
    debit,
    credit,
    memo: pickColumn(headers, MEMO_SYNONYMS),
    skip: null,
  };
}

export function parseFlexibleAmount(raw: string): number {
  let s = raw.trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) neg = true;
  s = s.replace(/[$,\s]/g, "").replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Bad amount: "${raw}"`);
  const cents = Math.round(parseFloat(s) * 100);
  return neg ? -cents : cents;
}

/** Parse dates: MM/DD/YYYY, M/D/YY, YYYY-MM-DD, DD-Mon-YYYY */
export function parseFlexibleDate(raw: string): string {
  const s = raw.trim();
  const us4 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us4) {
    return `${us4[3]}-${us4[1].padStart(2, "0")}-${us4[2].padStart(2, "0")}`;
  }
  const us2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (us2) {
    const y = parseInt(us2[3], 10);
    const year = y >= 70 ? 1900 + y : 2000 + y;
    return `${year}-${us2[1].padStart(2, "0")}-${us2[2].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mon = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (mon) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const m = months[mon[2].toLowerCase()];
    if (!m) throw new Error(`Bad date: "${raw}"`);
    return `${mon[3]}-${m}-${mon[1].padStart(2, "0")}`;
  }
  throw new Error(`Bad date: "${raw}"`);
}

export type ParsedBankRow = {
  date: string;
  description: string;
  amountCents: number;
  memo: string;
};

export function parseBankFlexible(
  csvText: string,
  mapping: BankColumnMapping,
): { rows: ParsedBankRow[]; error: string | null } {
  const records = parseCsv(csvText);
  if (!records.length) return { rows: [], error: "CSV has no data rows." };
  const headers = Object.keys(records[0]!);
  if (!mapping.date || (!mapping.amount && !(mapping.debit && mapping.credit))) {
    return {
      rows: [],
      error: "Could not find a date column and an amount (or debit/credit pair). Adjust the mapping dropdowns.",
    };
  }
  const descCol = mapping.description ?? headers[0]!;
  const parsed: (ParsedBankRow & { _idx: number })[] = [];
  try {
    for (let idx = 0; idx < records.length; idx++) {
      const r = records[idx]!;
      const date = parseFlexibleDate(r[mapping.date] ?? "");
      const description = (r[descCol] ?? "").trim() || "—";
      let amountCents = 0;
      if (mapping.amount) {
        amountCents = parseFlexibleAmount(r[mapping.amount] ?? "0");
      } else {
        const debit = parseFlexibleAmount(r[mapping.debit!] ?? "0");
        const credit = parseFlexibleAmount(r[mapping.credit!] ?? "0");
        if (!debit && !credit) continue;
        const d = debit ? -Math.abs(debit) : 0;
        const c = credit ? Math.abs(credit) : 0;
        amountCents = d + c;
      }
      const memo = mapping.memo ? (r[mapping.memo] ?? "") : "";
      parsed.push({ date, description, amountCents, memo, _idx: idx });
    }
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
  parsed.sort((a, b) => a.date.localeCompare(b.date) || a._idx - b._idx);
  return { rows: parsed.map(({ _idx, ...row }) => row), error: null };
}

export function assignTxnIds(rows: ParsedBankRow[]): Txn[] {
  return rows.map((r, i) => ({
    txnId: `T${String(i + 1).padStart(4, "0")}`,
    date: r.date,
    description: r.description,
    amountCents: r.amountCents,
    memo: r.memo,
  }));
}

export function detectAndParseBank(csvText: string): {
  mapping: BankColumnMapping;
  headers: string[];
  preview: ParsedBankRow[];
  txns: Txn[];
  error: string | null;
} {
  const records = parseCsv(csvText);
  const headers = records[0] ? Object.keys(records[0]) : [];
  const mapping = suggestBankMapping(headers);
  const { rows, error } = parseBankFlexible(csvText, mapping);
  const txns = assignTxnIds(rows);
  return { mapping, headers, preview: rows.slice(0, 5), txns, error };
}
