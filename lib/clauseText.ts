import type { GrantTerms } from "./types";

export function clauseTextsForRef(grantTerms: GrantTerms[], ref: string): { rule: string; ref: string }[] {
  const out: { rule: string; ref: string }[] = [];
  const section = ref.split(";")[0]!.trim();
  for (const g of grantTerms) {
    for (const u of g.unallowable) {
      if (u.clauseRef.startsWith(section) || section.startsWith(u.clauseRef.split(";")[0]!)) {
        out.push({ rule: u.rule, ref: u.clauseRef });
      }
    }
    for (const p of g.priorApproval) {
      if (p.clauseRef.startsWith(section) || section.startsWith(p.clauseRef.split(";")[0]!)) {
        out.push({ rule: p.rule, ref: p.clauseRef });
      }
    }
  }
  if (!out.length) return [{ rule: ref, ref }];
  return out;
}

export function contractClausesFromDecision(
  grantTerms: GrantTerms[],
  evidence: { source: string; ref: string; note: string }[],
): { rule: string; ref: string }[] {
  const refs = new Set<string>();
  for (const e of evidence) {
    if (e.source === "contract") refs.add(e.ref);
  }
  const stacked: { rule: string; ref: string }[] = [];
  for (const ref of refs) {
    for (const item of clauseTextsForRef(grantTerms, ref)) {
      if (!stacked.some((s) => s.ref === item.ref && s.rule === item.rule)) stacked.push(item);
    }
  }
  return stacked;
}
