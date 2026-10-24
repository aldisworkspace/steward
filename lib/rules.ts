/**
 * Deterministic verification layer. The model (or the bookkeeper's GL) proposes a coding;
 * these rules verify it against the contracts, time records, bank and precedents.
 * Rules never change data. They return findings with evidence and an optional suggestion
 * that a human must approve.
 */
import type { Candidate, Evidence, Finding, GlRow, GrantTerms, Precedent, StaffAllocation, Txn } from "./types";

export interface RuleInput {
  txns: Txn[];
  gl: GlRow[];
  staff: StaffAllocation[];
  grants: GrantTerms[];
  precedents: Precedent[];
  candidates: Map<string, Candidate>;
}

/** Differences below this are not worth a human's attention for duplicate checks. */
export const MATERIALITY_CENTS = 250_00;

const usd = (c: number) => `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isPayroll = (t: Txn) => /payroll/i.test(t.description);
const isOutflow = (t: Txn) => t.amountCents < 0;
const text = (t: Txn) => `${t.description} ${t.memo}`;

function daysBetween(a: string, b: string) {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

/** Keyword heuristics for unallowable categories. The model handles anything these miss. */
const UNALLOWABLE_PATTERNS: { id: string; txn: RegExp; termRule: RegExp; label: string }[] = [
  { id: "fines", txn: /citation|penalt|\bfine[sd]?\b|late fee/i, termRule: /fine|penalt/i, label: "fines and penalties" },
  { id: "fundraising", txn: /gala|benefit|fundrais|donor (event|dinner)|auction/i, termRule: /fundrais/i, label: "fundraising" },
  { id: "alcohol_staff", txn: /\bbar\b|brewery|brewing|wine|liquor|happy hour|appreciation/i,
    termRule: /alcohol|staff (meals|appreciation)/i, label: "alcohol / staff entertainment" },
  { id: "lobbying", txn: /lobby/i, termRule: /lobby/i, label: "lobbying" },
];

export function runRules(input: RuleInput): Finding[] {
  const { txns, gl, staff, grants, precedents, candidates } = input;
  const grantById = new Map(grants.map((g) => [g.grantId, g]));
  const txnById = new Map(txns.map((t) => [t.txnId, t]));
  const findings: Finding[] = [];
  const blockedOrDup = new Set<string>();

  // R-DEPOSIT-MISMATCH: bank is the system of record for cash.
  for (const row of gl) {
    const t = txnById.get(row.bankRef);
    if (!t) {
      findings.push({ ruleId: "R-GL-ORPHAN", txnId: row.bankRef, status: "needs_review",
        message: `Ledger entry "${row.description}" has no matching bank transaction.`,
        evidence: [{ source: "gl", ref: row.bankRef, note: `entered by ${row.enteredBy}` }] });
      continue;
    }
    if (t.amountCents !== row.amountCents) {
      findings.push({ ruleId: "R-DEPOSIT-MISMATCH", txnId: t.txnId, status: "needs_review",
        message: `Ledger records ${usd(row.amountCents)} but the bank shows ${usd(t.amountCents)}. The bank is the system of record for cash, so the ledger entry should be corrected by ${usd(row.amountCents - t.amountCents)}.`,
        evidence: [
          { source: "bank", ref: t.txnId, note: `${t.date} ${t.description} ${usd(t.amountCents)}` },
          { source: "gl", ref: row.bankRef, note: `${row.account} ${usd(row.amountCents)} (entered by ${row.enteredBy})` },
        ] });
    }
  }

  for (const t of txns) {
    const c = candidates.get(t.txnId);
    const g = c?.grantId ? grantById.get(c.grantId) : undefined;

    // R-PERIOD: costs must be incurred within the grant period.
    if (g && isOutflow(t) && (t.date < g.periodStart || t.date > g.periodEnd)) {
      blockedOrDup.add(t.txnId);
      findings.push({ ruleId: "R-PERIOD", txnId: t.txnId, status: "blocked",
        message: `Incurred ${t.date}, outside ${g.grantId}'s period (${g.periodStart} to ${g.periodEnd}). Cannot be charged to this grant; move to unrestricted funds.`,
        evidence: [{ source: "contract", ref: `${g.grantId} period of performance`, note: `${g.periodStart} – ${g.periodEnd}` },
                   { source: "bank", ref: t.txnId, note: `${t.date} ${t.description}` }],
        suggestion: [{ grantId: null, budgetLine: null, amountCents: t.amountCents }] });
    }

    // R-UNALLOWABLE: keyword heuristics matched against the grant's own unallowable list.
    if (g && isOutflow(t)) {
      for (const p of UNALLOWABLE_PATTERNS) {
        if (!p.txn.test(text(t))) continue;
        const terms = g.unallowable.filter((u) => p.termRule.test(u.rule));
        if (!terms.length) continue;
        blockedOrDup.add(t.txnId);
        findings.push({ ruleId: `R-UNALLOWABLE-${p.id.toUpperCase()}`, txnId: t.txnId, status: "blocked",
          message: `Looks like ${p.label}, which ${g.grantId} prohibits (${terms.map((u) => u.clauseRef).join("; ")}). Move to unrestricted funds.`,
          evidence: [...terms.map<Evidence>((u) => ({ source: "contract", ref: u.clauseRef, note: u.rule })),
                     { source: "bank", ref: t.txnId, note: text(t) }],
          suggestion: [{ grantId: null, budgetLine: null, amountCents: t.amountCents }] });
        break;
      }
    }

    // R-PRIOR-APPROVAL: single purchases at or above a contract threshold.
    if (g && isOutflow(t) && !isPayroll(t)) {
      for (const pa of g.priorApproval) {
        if (pa.thresholdUsd == null || -t.amountCents < pa.thresholdUsd * 100) continue;
        if (/stipend|payout/i.test(text(t))) continue;
        const prior = precedents.filter((p) => p.scope === g.grantId && /prior approval/i.test(p.ruling));
        findings.push({ ruleId: "R-PRIOR-APPROVAL", txnId: t.txnId, status: "needs_review",
          message: `${usd(t.amountCents)} single purchase meets the ${usd(pa.thresholdUsd * 100)} prior-approval threshold (${pa.clauseRef}). No approval on file — request it from the funder before charging, or move to unrestricted.`,
          evidence: [{ source: "contract", ref: pa.clauseRef, note: pa.rule },
                     ...prior.map<Evidence>((p) => ({ source: "precedent", ref: p.id, note: `${p.date} ${p.by}: ${p.ruling}` }))] });
      }
    }
  }

  // R-DUPLICATE: same vendor + same amount within 3 days, above materiality
  // (small identical recurring charges like transit reloads are normal, not duplicates).
  const outflows = txns.filter((t) => isOutflow(t) && -t.amountCents >= MATERIALITY_CENTS)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < outflows.length; i++) {
    for (let j = i + 1; j < outflows.length; j++) {
      const a = outflows[i], b = outflows[j];
      if (daysBetween(a.date, b.date) > 3) break;
      if (a.amountCents === b.amountCents && a.description === b.description && !isPayroll(a)) {
        blockedOrDup.add(b.txnId);
        findings.push({ ruleId: "R-DUPLICATE", txnId: b.txnId, status: "needs_review",
          message: `Possible duplicate of ${a.txnId}: same vendor and amount (${usd(b.amountCents)}) ${daysBetween(a.date, b.date)} day(s) apart. Confirm with the vendor before it is charged to a grant.`,
          evidence: [{ source: "bank", ref: a.txnId, note: `${a.date} ${a.description} ${usd(a.amountCents)}` },
                     { source: "bank", ref: b.txnId, note: `${b.date} ${b.description} ${usd(b.amountCents)}` }] });
      }
    }
  }

  // R-EFFORT: salary charged to a grant beyond the documented time-and-effort share.
  for (const t of txns.filter(isPayroll)) {
    const c = candidates.get(t.txnId);
    if (!c?.grantId) continue;
    const person = staff.find((s) => t.memo.includes(`(${s.employee})`));
    if (!person) continue;
    const key = `${c.grantId}:${c.budgetLine}`;
    const allowedPct = person.allocation.find((a) => a.key === key)?.pct ?? 0;
    if (allowedPct >= 0.999) continue;
    const over = Math.round(-t.amountCents * (1 - allowedPct));
    findings.push({ ruleId: "R-EFFORT", txnId: t.txnId, status: "needs_review",
      message: `${person.employee}'s pay (${usd(t.amountCents)}) is charged 100% to ${key}, but time records allocate ${Math.round(allowedPct * 100)}%. Overcharge: ${usd(over)}. Split per the allocation.`,
      evidence: [{ source: "time_record", ref: `staff_allocation:${person.employee}`, note: person.allocation.map((a) => `${a.key}=${Math.round(a.pct * 100)}%`).join("; ") },
                 { source: c.origin === "gl" ? "gl" : "rule", ref: t.txnId, note: `charged to ${key}` }],
      suggestion: person.allocation.map((a) => {
        const [grantId, budgetLine] = a.key === "UNRESTRICTED" ? [null, null] : a.key.split(":");
        return { grantId, budgetLine, amountCents: Math.round(t.amountCents * a.pct) };
      }) });
  }

  // R-LINE-OVERRUN: cumulative spend per grant line vs budget + allowed variance.
  for (const g of grants) {
    if (g.lineVarianceLimitPct == null) continue;
    for (const line of g.budgetLines) {
      const cap = Math.round(line.amount * 100 * (1 + g.lineVarianceLimitPct / 100));
      let running = 0;
      const charged = txns
        .filter((t) => { const c = candidates.get(t.txnId); return c?.grantId === g.grantId && c.budgetLine === line.code && !blockedOrDup.has(t.txnId); })
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const t of charged) {
        running += -t.amountCents;
        if (running > cap) {
          findings.push({ ruleId: "R-LINE-OVERRUN", txnId: t.txnId, status: "needs_review",
            message: `This charge takes ${g.grantId} line ${line.code} (${line.name}) to ${usd(running)} vs budget ${usd(line.amount * 100)} — over the ${g.lineVarianceLimitPct}% variance allowed without approval (cap ${usd(cap)}).`,
            evidence: [{ source: "contract", ref: `${g.grantId} budget ${line.code}`, note: `budget ${usd(line.amount * 100)}, variance limit ${g.lineVarianceLimitPct}%` }] });
          break;
        }
      }
    }
  }

  return findings;
}
