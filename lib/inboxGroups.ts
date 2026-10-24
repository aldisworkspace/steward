export type QueueRow = {
  txnId: string;
  status: string;
  amountCents: number;
  description: string;
  reason: string;
  ruleId?: string | null;
  grantId?: string | null;
  entryId?: string | null;
  atRiskCents?: number;
  employee?: string | null;
  resolved?: boolean;
};

export type QueueGroup =
  | { kind: "single"; row: QueueRow }
  | { kind: "group"; key: string; label: string; ruleId: string | null; rows: QueueRow[]; atRiskCents: number };

export function groupInboxRows(rows: QueueRow[]): QueueGroup[] {
  const byKey = new Map<string, QueueRow[]>();
  for (const r of rows) {
    const employee = r.employee ?? r.description.split(/\s+/)[0] ?? "Vendor";
    const key = `${r.ruleId ?? "none"}|${employee}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const out: QueueGroup[] = [];
  for (const [, list] of byKey) {
    if (list.length >= 2 && list[0]?.ruleId === "R-EFFORT") {
      const atRisk = list.reduce((a, r) => a + (r.atRiskCents ?? 0), 0);
      const emp = list[0]!.employee ?? "Employee";
      const short = emp.includes(". ") ? emp : emp.split(/\s+/)[0] ?? emp;
      out.push({
        kind: "group",
        key: `g-${list[0]!.ruleId}-${short}`,
        label: `${short}'s pay exceeds time sheets ×${list.length}`,
        ruleId: list[0]!.ruleId ?? null,
        rows: list,
        atRiskCents: atRisk,
      });
    } else {
      for (const row of list) out.push({ kind: "single", row });
    }
  }
  return out;
}
