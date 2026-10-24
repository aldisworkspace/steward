import { UNALLOWABLE_TERM_PATTERNS } from "./rules";
import type { GrantTerms, Status, Txn } from "./types";

export type ConcernInput = {
  status: Status;
  reason: string;
  clauseRef?: string | null;
};

function ruleFromUnallowableTerm(ruleText: string): string {
  for (const p of UNALLOWABLE_TERM_PATTERNS) {
    if (!p.termRule.test(ruleText)) continue;
    if (p.id === "fines") return "R-UNALLOWABLE-FINES";
    if (p.id === "fundraising") return "R-UNALLOWABLE-FUNDRAISING";
    if (p.id === "alcohol_staff") return "R-UNALLOWABLE-ALCOHOL_STAFF";
    if (p.id === "lobbying") return "R-UNALLOWABLE-LOBBYING";
    return "R-UNALLOWABLE-OTHER";
  }
  return "R-UNALLOWABLE-OTHER";
}

function clauseMatches(ref: string, clauseRef: string): boolean {
  const a = ref.split(";")[0]!.trim();
  const b = clauseRef.split(";")[0]!.trim();
  return a.length > 0 && (clauseRef.startsWith(a) || a.startsWith(b));
}

export function categorizeConcern(
  concern: ConcernInput,
  grants: GrantTerms[],
  txn: Txn,
): { ruleId: string; message: string; evidence: { source: "contract"; ref: string; note: string }[] } {
  const ref = (concern.clauseRef ?? "").trim();

  for (const g of grants) {
    for (const u of g.unallowable) {
      if (ref && !clauseMatches(ref, u.clauseRef)) continue;
      if (!ref && ref !== "") {
        /* no ref: try all grants */
      }
      if (ref && clauseMatches(ref, u.clauseRef)) {
        return {
          ruleId: ruleFromUnallowableTerm(u.rule),
          message: concern.reason,
          evidence: [{ source: "contract", ref: u.clauseRef, note: u.rule }],
        };
      }
    }
    for (const p of g.priorApproval) {
      if (ref && clauseMatches(ref, p.clauseRef)) {
        return {
          ruleId: "R-PRIOR-APPROVAL",
          message: concern.reason,
          evidence: [{ source: "contract", ref: p.clauseRef, note: p.rule }],
        };
      }
    }
  }

  if (ref) {
    for (const g of grants) {
      for (const u of g.unallowable) {
        if (clauseMatches(ref, u.clauseRef)) {
          return {
            ruleId: ruleFromUnallowableTerm(u.rule),
            message: concern.reason,
            evidence: [{ source: "contract", ref: u.clauseRef, note: u.rule }],
          };
        }
      }
      for (const p of g.priorApproval) {
        if (clauseMatches(ref, p.clauseRef)) {
          return {
            ruleId: "R-PRIOR-APPROVAL",
            message: concern.reason,
            evidence: [{ source: "contract", ref: p.clauseRef, note: p.rule }],
          };
        }
      }
      const inPeriod = txn.date >= g.periodStart && txn.date <= g.periodEnd;
      if (!inPeriod && ref.includes(g.grantId)) {
        return {
          ruleId: "R-PERIOD",
          message: concern.reason,
          evidence: [
            {
              source: "contract",
              ref: `${g.grantId} period of performance`,
              note: `${g.periodStart} – ${g.periodEnd}`,
            },
          ],
        };
      }
    }
  }

  return {
    ruleId: "R-MODEL-REVIEW",
    message: concern.reason,
    evidence: ref ? [{ source: "contract", ref, note: concern.reason }] : [],
  };
}
