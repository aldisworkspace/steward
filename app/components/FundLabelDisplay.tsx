"use client";

import { getFundLabel, grantTermsList } from "@/lib/fundLabels";
import type { GrantTerms } from "@/lib/types";

export function FundLabelDisplay({
  grantId,
  grants,
  showCode = "meta",
  subtitle = false,
}: {
  grantId: string | null;
  grants: GrantTerms[] | { terms: unknown }[] | undefined;
  showCode?: "meta" | "hidden" | "inline";
  subtitle?: boolean;
}) {
  const label = getFundLabel(grantId, grants);
  return (
    <span className="inline">
      <span className="font-medium text-ink">{label.title}</span>
      {subtitle && label.subtitle && (
        <span className="mt-0.5 block text-[13px] font-normal text-ink-2">{label.subtitle}</span>
      )}
      {showCode === "meta" && label.code && (
        <span className="ml-1 text-[13px] font-normal text-ink-2">{label.code}</span>
      )}
      {showCode === "inline" && label.code && (
        <span className="text-ink-2"> ({label.code})</span>
      )}
    </span>
  );
}

export function BudgetLineDisplay({
  grantId,
  code,
  grants,
}: {
  grantId: string | null;
  code: string | null;
  grants: GrantTerms[] | { terms: unknown }[] | undefined;
}) {
  if (!code) return <span className="text-ink-2">—</span>;
  const terms = grantTermsList(grants);
  const t = terms.find((g) => g.grantId === grantId);
  const bl = t?.budgetLines.find((l) => l.code === code);
  const name = bl?.name ?? code;
  return (
    <span>
      <span className="text-ink">{name}</span>
      {bl && code !== name && <span className="ml-1 text-[13px] text-ink-2">{code}</span>}
    </span>
  );
}
