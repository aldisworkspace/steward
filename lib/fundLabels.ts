import type { GrantTerms } from "./types";

export type FundLabel = {
  title: string;
  subtitle: string;
  code: string | null;
};

export function grantTermsList(
  grants: GrantTerms[] | { terms: unknown }[] | undefined,
): GrantTerms[] {
  if (!grants?.length) return [];
  const row = grants[0] as { terms?: unknown; grantId?: string };
  if (row && "terms" in row && row.terms) {
    return grants
      .map((g) => (g as { terms: unknown }).terms as GrantTerms)
      .filter((t): t is GrantTerms => !!t?.grantId);
  }
  return (grants as GrantTerms[]).filter((t) => !!t?.grantId);
}

function stripFictional(s: string): string {
  return s.replace(/\s*\(fictional[^)]*\)/gi, "").trim();
}

export function getFundLabel(
  grantId: string | null | undefined,
  grants: GrantTerms[] | { terms: unknown }[] | undefined,
): FundLabel {
  if (!grantId) {
    return { title: "General funds", subtitle: "No funder restrictions", code: null };
  }
  const terms = grantTermsList(grants);
  const t = terms.find((g) => g.grantId === grantId);
  if (!t) {
    return { title: grantId, subtitle: "", code: grantId };
  }
  const title = (t.program?.trim() || stripFictional(t.funder)) ?? grantId;
  const funderShort = stripFictional(t.funder);
  const subtitle = funderShort ? `${funderShort} grant` : "Grant";
  return { title, subtitle, code: t.grantId };
}

export function budgetLineLabel(
  grantId: string | null,
  code: string | null,
  grants: GrantTerms[] | { terms: unknown }[] | undefined,
): { name: string; code: string | null } {
  if (!code) return { name: "—", code: null };
  const terms = grantTermsList(grants);
  const t = terms.find((g) => g.grantId === grantId);
  const bl = t?.budgetLines.find((l) => l.code === code);
  return { name: bl?.name ?? code, code };
}

export function formatBudgetLineText(
  grantId: string | null,
  code: string | null,
  grants: GrantTerms[] | { terms: unknown }[] | undefined,
): string {
  const { name, code: c } = budgetLineLabel(grantId, code, grants);
  if (!c || name === c) return name;
  return `${name} · ${c}`;
}
