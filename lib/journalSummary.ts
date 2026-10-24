import { ruleLabel } from "./ruleLabels";
import type { ProposedEntryDraft } from "./pipeline";
import type { Decision, Finding, GlRow, StaffAllocation, Txn } from "./types";

function usd(cents: number) {
  return `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function shortReason(ruleId: string): string {
  const l = ruleLabel(ruleId).toLowerCase();
  if (l.includes("alcohol")) return "alcohol";
  if (l.includes("fine")) return "fine";
  if (l.includes("fundraising")) return "gala";
  if (l.includes("period")) return "out of period";
  if (l.includes("duplicate")) return "duplicate";
  return l.split(" ")[0] ?? ruleId;
}

function employeeFromMemo(memo: string): string | null {
  const m = memo.match(/\(([^)]+)\)/);
  return m?.[1] ?? null;
}

export function buildRunJournalLines(args: {
  txns: Txn[];
  gl: GlRow[];
  staff: StaffAllocation[];
  decisions: Decision[];
  findings: Finding[];
  entries: ProposedEntryDraft[];
}): string[] {
  const { txns, gl, staff, decisions, findings, entries } = args;
  const glByRef = new Map(gl.map((r) => [r.bankRef, r]));
  const lines: string[] = [];
  lines.push(`Picked up ${txns.length} bank transactions.`);

  const auto = decisions.filter((d) => d.status === "auto").length;
  lines.push(`Coded ${auto} automatically.`);

  const blocked = decisions.filter((d) => d.status === "blocked");
  const byGrant = new Map<string, { txnId: string; ruleId: string }[]>();
  for (const d of blocked) {
    const f = findings.find((x) => x.txnId === d.txnId && x.status === "blocked");
    const glRow = glByRef.get(d.txnId);
    const grant = d.grantId ?? glRow?.class ?? "unrestricted";
    const list = byGrant.get(grant) ?? [];
    list.push({ txnId: d.txnId, ruleId: f?.ruleId ?? "blocked" });
    byGrant.set(grant, list);
  }
  for (const [grantId, items] of byGrant) {
    const parts = items.map((i) => `${shortReason(i.ruleId)} (${i.txnId})`);
    lines.push(`Struck ${items.length} charge${items.length === 1 ? "" : "s"} off ${grantId}: ${parts.join(", ")}.`);
  }

  const effortTxns = decisions.filter((d) => d.ruleHits.includes("R-EFFORT") && d.splits);
  if (effortTxns.length) {
    let moved = 0;
    const grantsOff = new Set<string>();
    for (const d of effortTxns) {
      const t = txns.find((x) => x.txnId === d.txnId);
      if (!t) continue;
      const splits = d.splits ?? [];
      const onGrant = splits.filter((s) => s.grantId).reduce((a, s) => a + Math.abs(s.amount), 0);
      moved += Math.abs(t.amountCents) - onGrant;
      for (const s of splits) {
        if (s.grantId) grantsOff.add(s.grantId);
      }
      const glRow = glByRef.get(d.txnId);
      if (glRow?.class) grantsOff.add(glRow.class);
    }
    const first = effortTxns[0]!;
    const t0 = txns.find((x) => x.txnId === first.txnId);
    const person =
      employeeFromMemo(t0?.memo ?? "") ??
      staff.find((s) => t0?.memo.includes(`(${s.employee})`))?.employee ??
      "payroll";
    const grantList = [...grantsOff].join(", ") || "grant";
    lines.push(
      `Split ${effortTxns.length} ${person} paycheck${effortTxns.length === 1 ? "" : "s"} per time records — ${usd(moved)} moved off ${grantList}.`,
    );
  }

  for (const f of findings.filter((x) => x.ruleId === "R-DEPOSIT-MISMATCH")) {
    const t = txns.find((x) => x.txnId === f.txnId);
    const glRow = glByRef.get(f.txnId);
    if (!t || !glRow) continue;
    const gapCents = Math.abs(glRow.amountCents - t.amountCents);
    if (!gapCents) continue;
    const label = (t.memo || t.description).slice(0, 48);
    lines.push(`Flagged a ${usd(gapCents)} gap between ledger and bank on the ${label}.`);
  }

  const waiting = entries.length;
  if (waiting) {
    lines.push(`Waiting on Executive Director: ${waiting} journal entr${waiting === 1 ? "y" : "ies"}.`);
  }

  return lines;
}
