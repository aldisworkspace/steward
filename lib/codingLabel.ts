import { budgetLineLabel, getFundLabel, grantTermsList } from "./fundLabels";
import type { GrantTerms } from "./types";

export function matchGrantForInflow(
  description: string,
  memo: string,
  grants: GrantTerms[],
): string | null {
  const text = `${description} ${memo}`.toUpperCase();
  for (const g of grants) {
    if (text.includes(g.grantId)) return g.grantId;
    const funder = g.funder.trim();
    if (funder.length >= 4 && text.includes(funder.toUpperCase())) return g.grantId;
    const short = funder.split(/\s+/).slice(0, 2).join(" ").toUpperCase();
    if (short.length >= 4 && text.includes(short)) return g.grantId;
  }
  return null;
}

function chargeLabel(
  grantId: string | null,
  budgetLine: string | null,
  grants: GrantTerms[] | undefined,
  lineName?: (grantId: string | null, code: string | null) => string | undefined,
): string {
  const fund = getFundLabel(grantId, grants);
  if (!grantId) return fund.title;
  const name = lineName?.(grantId, budgetLine) ?? budgetLineLabel(grantId, budgetLine, grants).name;
  if (budgetLine && name) {
    const code = budgetLineLabel(grantId, budgetLine, grants).code;
    if (code && name !== code) return `${fund.title} · ${name} · ${code}`;
    return `${fund.title} · ${name}`;
  }
  return fund.title;
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
  const list = grants ?? [];
  if (amountCents > 0) {
    const gid = matchGrantForInflow(description ?? "", memo ?? "", list);
    if (gid) {
      const fund = getFundLabel(gid, list);
      return `Grant revenue · ${fund.title}`;
    }
    return "Revenue";
  }
  if (splits?.length) {
    const total = splits.reduce((a, s) => a + Math.abs(s.amount), 0);
    return splits
      .map((s) => {
        const pct = total ? Math.round((Math.abs(s.amount) / total) * 100) : 0;
        const base = chargeLabel(s.grantId, s.budgetLine, list, lineName);
        return `${base}  ${pct}%  $${(Math.abs(s.amount) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      })
      .join(" / ");
  }
  return chargeLabel(grantId, budgetLine, list, lineName);
}

export function lineNameFromGrants(
  grants: GrantTerms[] | { terms: unknown }[] | undefined,
  grantId: string | null,
  code: string | null,
): string | undefined {
  if (!grantId || !code) return undefined;
  const terms = grantTermsList(grants);
  const t = terms.find((g) => g.grantId === grantId);
  return t?.budgetLines.find((l) => l.code === code)?.name;
}
