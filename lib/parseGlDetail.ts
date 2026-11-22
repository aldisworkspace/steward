/**
 * GL detail ingest: QuickBooks "Transaction Detail by Account", Xero "Account Transactions",
 * Sage Intacct GL detail, or any CSV with a manual column mapping.
 *
 * Output follows the app's bank convention: `amountCents` < 0 is an expense / money out.
 *
 * Which lines are kept (documented choice):
 * - Expense accounts are always kept (they are what gets charged to grants).
 * - Revenue and balance-sheet lines are skipped, UNLESS they carry a grant class
 *   (e.g. equipment capitalised to a fixed-asset account and coded to a grant, or a grant
 *   revenue/refund line). Cash, bank, card, payable/receivable and clearing accounts are always
 *   skipped: they are the payment side of an expense line already counted, so keeping them
 *   would double count.
 * - Zero-amount, total and section-heading rows are skipped and reported in `skipped`.
 */
import { parseCsv } from "./parse";
import { parseFlexibleAmount, parseFlexibleDate } from "./parseFlexible";
import type { GlRow, Txn } from "./types";

export type GlColumnRole =
  | "date" | "txnType" | "docRef" | "vendor" | "memo" | "account" | "grant" | "budgetLine"
  | "department" | "amount" | "debit" | "credit" | "split" | "enteredBy";

export const GL_ROLES: GlColumnRole[] = [
  "date", "txnType", "docRef", "vendor", "memo", "account", "grant", "budgetLine",
  "department", "amount", "debit", "credit", "split", "enteredBy",
];

export type GlColumnMapping = Record<GlColumnRole, string | null>;
export type GlFormat = "quickbooks" | "xero" | "sage" | "generic";

/** Exact (normalised) header synonyms, most specific first. Order of roles matters: see ROLE_ORDER. */
const SYNONYMS: Record<GlColumnRole, string[]> = {
  date: ["date", "posting date", "transaction date", "txn date", "gl date", "entry date"],
  txnType: ["transaction type", "type", "source", "journal", "journal type"],
  docRef: ["num", "no.", "no", "document", "document number", "doc no", "reference", "ref", "check no", "invoice", "invoice no"],
  vendor: ["name", "vendor name", "vendor", "payee", "contact", "customer/vendor", "employee"],
  memo: ["memo/description", "memo", "description", "line description", "line memo"],
  account: ["account", "account name", "gl account", "account code", "full name"],
  grant: ["class", "class/grant", "grant", "tracking", "tracking category", "tracking category 1", "fund", "project", "grant:line"],
  budgetLine: ["budget line", "budget_line", "budget code", "line"],
  department: ["location", "department", "program", "dept"],
  amount: ["amount", "net amount", "net"],
  debit: ["debit", "debit amount", "debits"],
  credit: ["credit", "credit amount", "credits"],
  split: ["split"],
  enteredBy: ["entered by", "created by", "user", "entered_by", "modified by"],
};

/** Loose `includes` fallback only for roles where substrings are unambiguous. */
const LOOSE: Partial<Record<GlColumnRole, string[]>> = {
  date: ["date"],
  debit: ["debit"],
  credit: ["credit"],
  amount: ["amount"],
  account: ["account"],
};

// Specific roles claim headers first so "Memo/Description" is not taken as a vendor, etc.
const ROLE_ORDER: GlColumnRole[] = [
  "debit", "credit", "split", "txnType", "docRef", "memo", "vendor", "account", "grant", "budgetLine",
  "department", "enteredBy", "date", "amount",
];

const norm = (h: string) => h.trim().toLowerCase().replace(/[*:]+$/, "").replace(/\s+/g, " ");

export function suggestGlMapping(headers: string[]): GlColumnMapping {
  const used = new Set<string>();
  const out = Object.fromEntries(GL_ROLES.map((r) => [r, null])) as GlColumnMapping;
  const normed = headers.map((raw) => ({ raw, n: norm(raw) }));
  for (const role of ROLE_ORDER) {
    let hit: string | null = null;
    for (const syn of SYNONYMS[role]) {
      const h = normed.find((x) => !used.has(x.raw) && x.n === syn);
      if (h) { hit = h.raw; break; }
    }
    if (!hit) {
      for (const syn of LOOSE[role] ?? []) {
        const h = normed.find((x) => !used.has(x.raw) && x.n.includes(syn));
        if (h) { hit = h.raw; break; }
      }
    }
    if (hit) { out[role] = hit; used.add(hit); }
  }
  // Xero puts "Description" as the narrative and has no separate memo; Sage has both
  // "Description" (memo) and "Vendor name". Nothing else to do: memo picked "description".
  // When there is a debit/credit pair, prefer it over a lone "Amount"/"Net" column.
  if (out.debit && out.credit && out.amount) out.amount = null;
  return out;
}

export function detectGlFormat(headers: string[]): GlFormat {
  const h = new Set(headers.map(norm));
  if (h.has("transaction type") && (h.has("num") || h.has("split") || h.has("memo/description"))) return "quickbooks";
  if (h.has("source") && h.has("reference") && [...h].some((x) => x.startsWith("tracking") || x === "debit")) return "xero";
  if (h.has("posting date") || (h.has("document") && h.has("vendor name"))) return "sage";
  return "generic";
}

export type AccountKind = "expense" | "revenue" | "cash" | "balance";

/** Classify an account by number range (common nonprofit chart) then by name. */
export function accountKind(account: string): AccountKind {
  const a = account.trim();
  const name = a.toLowerCase();
  if (/\b(checking|savings|cash|petty cash|undeposited|bank account|cash in bank|credit card|visa|amex|mastercard|accounts payable|a\/p|accounts receivable|a\/r|clearing|payroll liabilit)/i.test(name)) return "cash";
  const num = a.match(/^(\d{4,5})\b/);
  if (num) {
    const d = num[1]![0]!;
    if (d === "1" || d === "2" || d === "3") return "balance";
    if (d === "4") return "revenue";
    return "expense";
  }
  if (/revenue|income|contribution|donation|grant receipts|interest earned/i.test(name)) return "revenue";
  if (/receivable|payable|accrued|prepaid|deposit|equity|net assets|fixed asset|accumulated|loan|deferred/i.test(name)) return "balance";
  return "expense";
}

const GENERAL_CLASS = /^(general|unrestricted|general funds?|operating|admin(istration)?|none|n\/a|-)$/i;

/** "GA-2026-114:A3" → {grantId, budgetLine}; "General" → nulls; "GA-2026-114" + line column. */
export function parseClass(raw: string | undefined, lineRaw?: string): { grantId: string | null; budgetLine: string | null } {
  const s = (raw ?? "").trim();
  const line = (lineRaw ?? "").trim() || null;
  if (!s || GENERAL_CLASS.test(s)) return { grantId: null, budgetLine: null };
  for (const sep of [":", " / ", " - "]) {
    const idx = s.lastIndexOf(sep);
    if (idx > 0) {
      const g = s.slice(0, idx).trim(), l = s.slice(idx + sep.length).trim();
      if (g && l) {
        if (GENERAL_CLASS.test(g)) return { grantId: null, budgetLine: null };
        return { grantId: g, budgetLine: l };
      }
    }
  }
  return { grantId: s, budgetLine: line };
}

export interface GlLine extends Txn {
  source: "gl";
  vendor: string;
  account: string;
  department: string;
  docRef: string;
  txnType: string;
  glClass: string | null;
  glBudgetLine: string | null;
  enteredBy: string;
}

export interface GlParseResult {
  format: GlFormat;
  headers: string[];
  mapping: GlColumnMapping;
  lines: GlLine[];
  glRows: GlRow[];
  skipped: { row: number; reason: string }[];
  error: string | null;
}

/** QuickBooks exports start with title rows; find the real header line. */
function stripPreamble(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const cells = lines[i]!.toLowerCase();
    if (/\bdate\b/.test(cells) && /(amount|debit|credit)/.test(cells)) return lines.slice(i).join("\n");
  }
  return text;
}

export function parseGlDetail(csvText: string, mappingOverride?: Partial<GlColumnMapping>, opts: { idPrefix?: string } = {}): GlParseResult {
  const records = parseCsv(stripPreamble(csvText));
  const headers = records[0] ? Object.keys(records[0]) : [];
  const mapping: GlColumnMapping = { ...suggestGlMapping(headers), ...(mappingOverride ?? {}) };
  const format = detectGlFormat(headers);
  const empty = { format, headers, mapping, lines: [], glRows: [], skipped: [] };
  if (!records.length) return { ...empty, error: "CSV has no data rows." };
  if (!mapping.date || (!mapping.amount && !(mapping.debit || mapping.credit))) {
    return { ...empty, error: "Could not find a date column and an amount (or debit/credit) column. Adjust the mapping." };
  }

  const skipped: GlParseResult["skipped"] = [];
  const parsed: (Omit<GlLine, "txnId"> & { _idx: number })[] = [];
  let sectionAccount = "";
  const get = (r: Record<string, string>, role: GlColumnRole) => (mapping[role] ? (r[mapping[role]!] ?? "").trim() : "");

  for (let idx = 0; idx < records.length; idx++) {
    const r = records[idx]!;
    const rowNo = idx + 2;
    const dateRaw = get(r, "date");
    const firstCell = (Object.values(r)[0] ?? "").trim();
    if (!dateRaw) {
      // QuickBooks section heading ("6100 Office Supplies") or a "Total for …" row.
      if (firstCell && !/^total/i.test(firstCell) && Object.values(r).filter((x) => x.trim()).length === 1) sectionAccount = firstCell;
      skipped.push({ row: rowNo, reason: /^total/i.test(firstCell) ? "total row" : "no date" });
      continue;
    }
    if (/^total/i.test(firstCell)) { skipped.push({ row: rowNo, reason: "total row" }); continue; }
    let date: string;
    try {
      date = parseFlexibleDate(dateRaw);
      const [y, m, d] = date.split("-").map(Number);
      const dt = new Date(Date.UTC(y!, m! - 1, d!));
      if (dt.getUTCMonth() !== m! - 1 || dt.getUTCDate() !== d!) throw new Error(`Bad date: "${dateRaw}"`);
    } catch (e) {
      return { ...empty, skipped, error: `Row ${rowNo}: ${(e as Error).message}` };
    }
    const account = get(r, "account") || sectionAccount || "Uncategorized Expense";
    const kind = accountKind(account);
    const { grantId, budgetLine } = parseClass(get(r, "grant"), get(r, "budgetLine"));

    let amountCents: number;
    try {
      if (mapping.amount) {
        const a = parseFlexibleAmount(get(r, "amount") || "0");
        // QuickBooks shows amounts in the account's normal-balance sense: positive on an
        // expense/asset account is a debit (money out); positive on revenue/liability is a credit.
        const debitNormal = kind === "expense" || (kind === "balance" && !/payable|accrued|deferred|loan/i.test(account));
        amountCents = debitNormal ? -a : a;
      } else {
        const d = parseFlexibleAmount(get(r, "debit") || "0");
        const c = parseFlexibleAmount(get(r, "credit") || "0");
        amountCents = c - d; // debit = money out (negative), credit = money in
      }
    } catch (e) {
      return { ...empty, skipped, error: `Row ${rowNo}: ${(e as Error).message}` };
    }
    if (!amountCents) { skipped.push({ row: rowNo, reason: "zero amount" }); continue; }
    if (kind === "cash") { skipped.push({ row: rowNo, reason: `payment-side account (${account})` }); continue; }
    if ((kind === "revenue" || kind === "balance") && !grantId) {
      skipped.push({ row: rowNo, reason: `${kind === "revenue" ? "revenue" : "balance-sheet"} line without a grant class` });
      continue;
    }

    const vendor = get(r, "vendor");
    const memo = get(r, "memo");
    // Xero/Sage without a contact column: the narrative doubles as the vendor text.
    const description = vendor || memo || get(r, "docRef") || "—";
    parsed.push({
      date, description, amountCents, memo: vendor ? memo : "",
      source: "gl", vendor: vendor || description, account, department: get(r, "department"),
      docRef: get(r, "docRef"), txnType: get(r, "txnType"),
      glClass: grantId, glBudgetLine: budgetLine, enteredBy: get(r, "enteredBy") || "bookkeeper",
      _idx: idx,
    });
  }

  parsed.sort((a, b) => a.date.localeCompare(b.date) || a._idx - b._idx);
  const prefix = opts.idPrefix ?? "L";
  const lines: GlLine[] = parsed.map(({ _idx, ...row }, i) => ({ txnId: `${prefix}${String(i + 1).padStart(4, "0")}`, ...row }));
  const glRows: GlRow[] = lines.map((l) => ({
    bankRef: l.txnId, date: l.date, description: l.description, amountCents: l.amountCents,
    account: l.account, class: l.glClass, budgetLine: l.glBudgetLine, enteredBy: l.enteredBy,
  }));
  return { format, headers, mapping, lines, glRows, skipped, error: null };
}
