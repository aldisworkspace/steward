import { ruleLabel } from "./ruleLabels";
import type { ProposedEntryDraft } from "./pipeline";
import type { Decision, Finding, Txn } from "./types";

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

export function buildRunJournalLines(args: {
  txns: Txn[];
  decisions: Decision[];
  findings: Finding[];
  entries: ProposedEntryDraft[];
}): string[] {
  const { txns, decisions, findings, entries } = args;
  const lines: string[] = [];
  lines.push(`Picked up ${txns.length} bank transactions.`);

  const auto = decisions.filter((d) => d.status === "auto").length;
  lines.push(`Coded ${auto} automatically.`);

  const blocked = decisions.filter((d) => d.status === "blocked");
  const byGrant = new Map<string, { txnId: string; ruleId: string }[]>();
  for (const d of blocked) {
    const f = findings.find((x) => x.txnId === d.txnId && x.status === "blocked");
    const grant = d.grantId ?? "grant";
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
    let grantOff: string | null = null;
    for (const d of effortTxns) {
      const t = txns.find((x) => x.txnId === d.txnId);
      if (!t) continue;
      const splits = d.splits ?? [];
      const onGrant = splits.filter((s) => s.grantId).reduce((a, s) => a + Math.abs(s.amount), 0);
      const full = Math.abs(t.amountCents);
      moved += full - onGrant;
      grantOff = d.grantId ?? splits.find((s) => s.grantId)?.grantId ?? grantOff;
    }
    lines.push(
      `Split ${effortTxns.length} M. Chen paycheck${effortTxns.length === 1 ? "" : "s"} per time records — ${usd(moved)} moved off ${grantOff ?? "GA-2026-114"}.`,
    );
  }

  const deposit = findings.filter((f) => f.ruleId === "R-DEPOSIT-MISMATCH");
  for (const f of deposit) {
    const t = txns.find((x) => x.txnId === f.txnId);
    const g = f.evidence.find((e) => e.source === "gl");
    const b = f.evidence.find((e) => e.source === "bank");
    if (t && g && b) {
      const glC = parseFloat(g.note.replace(/[^0-9.-]/g, "")) * 100;
      const bankC = Math.abs(t.amountCents);
      const gap = Math.abs(glC - bankC) / 100;
      const label = t.description.includes("GGRWA") ? "GGRWA advance" : t.description.slice(0, 40);
      lines.push(`Flagged a ${usd(gap * 100)} gap between ledger and bank on the ${label}.`);
    }
  }

  const waiting = entries.length;
  if (waiting) {
    lines.push(`Waiting on Executive Director: ${waiting} journal entr${waiting === 1 ? "y" : "ies"}.`);
  }

  return lines;
}
