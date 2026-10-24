export function fmtTableAmount(cents: number): string {
  const n = Math.abs(cents) / 100;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `(${s})` : s;
}

export function fmtSentenceAmount(cents: number): string {
  const n = Math.abs(cents) / 100;
  const s = n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return cents < 0 ? `−${s}` : s;
}

export function fmtRisk(cents: number): string {
  return fmtSentenceAmount(cents).replace("−", "");
}

export function lineLabel(
  grantId: string | null,
  budgetLine: string | null,
  lineName?: string,
): string {
  if (!grantId) return "Unrestricted funds";
  const line = budgetLine ? ` · ${budgetLine}${lineName ? ` ${lineName}` : ""}` : "";
  return `${grantId}${line}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function splitLabel(
  splits: { grantId: string | null; budgetLine: string | null; amount: number }[],
): string {
  return splits
    .map((s) => {
      const pct = splits.length > 1 ? "" : "";
      void pct;
      const label = lineLabel(s.grantId, s.budgetLine);
      return label;
    })
    .join(" / ");
}
