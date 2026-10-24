import type { GlRow, StaffAllocation, Txn } from "./types";

/** Minimal RFC-4180 CSV parser (quotes, commas inside quotes, escaped quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

export function toCents(s: string): number {
  const clean = s.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(clean)) throw new Error(`Bad amount: "${s}"`);
  return Math.round(parseFloat(clean) * 100);
}

/** Accepts MM/DD/YYYY or YYYY-MM-DD; returns YYYY-MM-DD. */
export function toIsoDate(s: string): string {
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new Error(`Bad date: "${s}"`);
}

/** Bank CSV rows get stable ids T0001.. in file order (file is date-sorted). */
export function parseBank(text: string): Txn[] {
  return parseCsv(text).map((r, i) => ({
    txnId: `T${String(i + 1).padStart(4, "0")}`,
    date: toIsoDate(r["Posting Date"]),
    description: r["Description"],
    amountCents: toCents(r["Amount"]),
    memo: r["Memo"] ?? "",
  }));
}

export function parseGl(text: string): GlRow[] {
  return parseCsv(text).map((r) => ({
    bankRef: r.bank_ref, date: toIsoDate(r.date), description: r.description,
    amountCents: toCents(r.amount), account: r.account,
    class: r.class || null, budgetLine: r.budget_line || null, enteredBy: r.entered_by,
  }));
}

export function parseStaff(text: string): StaffAllocation[] {
  return parseCsv(text).map((r) => ({
    employee: r.employee, role: r.role, biweeklyCents: toCents(r.biweekly_gross_usd),
    allocation: r.allocation.split(";").map((part) => {
      const [key, pct] = part.split("=");
      return { key: key.trim(), pct: parseFloat(pct) / 100 };
    }),
  }));
}
