export type QueueRow = {
  txnId: string;
  status: string;
  amountCents: number;
  description: string;
  reason: string;
  ruleId?: string | null;
  entryId?: string | null;
  resolved?: boolean;
};

export type QueueGroup =
  | { kind: "single"; row: QueueRow }
  | { kind: "group"; key: string; label: string; ruleId: string | null; rows: QueueRow[]; atRiskCents: number };

export function groupInboxRows(rows: QueueRow[]): QueueGroup[] {
  const byKey = new Map<string, QueueRow[]>();
  for (const r of rows) {
    const vendor = r.description.split(/\s+/).slice(0, 2).join(" ");
    const key = `${r.ruleId ?? "none"}|${vendor}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const out: QueueGroup[] = [];
  for (const [, list] of byKey) {
    if (list.length >= 2 && list[0]?.ruleId === "R-EFFORT") {
      const atRisk = list.reduce((a, r) => a + Math.abs(r.amountCents), 0);
      out.push({
        kind: "group",
        key: `g-${list[0]!.ruleId}-${list[0]!.description}`,
        label: `${list[0]!.description.split(/\s+/)[0] ?? "Vendor"} — ${list[0]!.reason} ×${list.length}`,
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
