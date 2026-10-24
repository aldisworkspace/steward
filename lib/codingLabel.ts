import type { GrantTerms } from "./types";

export function matchGrantForInflow(
  description: string,
  memo: string,
  grants: GrantTerms[],
): string | null {
  const text = `${description} ${memo}`.toUpperCase();
  for (const g of grants) {
    if (text.includes(g.grantId)) return g.grantId;
    if (text.includes(g.funder.toUpperCase().slice(0, 12))) return g.grantId;
    if (g.grantId === "GA-2026-114" && /GGRWA|GOLDEN GATE REGIONAL/i.test(text)) return g.grantId;
    if (g.grantId === "HLF-26-031" && /HARBOR LIGHT/i.test(text)) return g.grantId;
  }
  return null;
}

export function stewardCodingLabel(args: {
  amountCents: number;
  grantId: string | null;
  budgetLine: string | null;
  splits?: { grantId: string | null; budgetLine: string | null; amount: number }[];
  lineName?: (grantId: string | null, code: string | null) => string | undefined;
  grants?: GrantTerms[];
  description?: string;
  memo?: string;
}): string {
  const { amountCents, grantId, budgetLine, splits, lineName, grants, description, memo } = args;
  if (amountCents > 0) {
    const gid = matchGrantForInflow(description ?? "", memo ?? "", grants ?? []);
    return gid ? `Grant revenue · ${gid}` : "Revenue";
  }
  if (splits?.length) {
    const total = splits.reduce((a, s) => a + Math.abs(s.amount), 0);
    return splits
      .map((s) => {
        const pct = total ? Math.round((Math.abs(s.amount) / total) * 100) : 0;
        const name = lineName?.(s.grantId, s.budgetLine);
        const base =
          s.grantId === null
            ? "Unrestricted"
            : `${s.grantId}${s.budgetLine ? ` · ${s.budgetLine}${name ? ` ${name}` : ""}` : ""}`;
        return `${base}  ${pct}%  $${(Math.abs(s.amount) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      })
      .join(" / ");
  }
  if (!grantId) return "Unrestricted funds";
  const name = lineName?.(grantId, budgetLine);
  return `${grantId}${budgetLine ? ` · ${budgetLine}${name ? ` ${name}` : ""}` : ""}`;
}
