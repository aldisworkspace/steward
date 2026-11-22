import type { StaffAllocation, Txn } from "./types";

export const PAYROLL_RE = /payroll|gusto|adp|paychex|salary|wages/i;

/** GL-first lines also carry the account ("6000 Salaries & Wages"). */
const PAYROLL_ACCOUNT_RE = /salar|wages|payroll|fringe|employee benefits/i;

export function isPayrollTxn(t: Txn): boolean {
  return PAYROLL_RE.test(t.description) || PAYROLL_RE.test(t.memo) || (!!t.account && PAYROLL_ACCOUNT_RE.test(t.account));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match employee full name or last name (word boundary) in description or memo. */
export function matchStaffForTxn(t: Txn, staff: StaffAllocation[]): StaffAllocation | undefined {
  const hay = `${t.description} ${t.memo}`.toLowerCase();
  for (const person of staff) {
    const full = person.employee.trim();
    if (!full) continue;
    const fullRe = new RegExp(`\\b${escapeRe(full.toLowerCase())}\\b`, "i");
    if (fullRe.test(hay)) return person;
    const parts = full.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 2) {
      const lastRe = new RegExp(`\\b${escapeRe(last.toLowerCase())}\\b`, "i");
      if (lastRe.test(hay)) return person;
    }
  }
  return undefined;
}
