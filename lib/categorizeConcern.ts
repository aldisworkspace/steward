import { UNALLOWABLE_TERM_PATTERNS } from "./rules";
import type { GrantTerms, Status, Txn } from "./types";

export type ConcernInput = {
  status: Status;
  reason: string;
  clauseRef?: string | null;
};

export type CategorizedConcern = {
  ruleId: string;
  /** Verified status: a model "blocked" only survives when it cites a prohibition of the charged grant. */
  status: "needs_review" | "blocked";
  message: string;
  evidence: { source: "contract"; ref: string; note: string }[];
};

const patternById = new Map(UNALLOWABLE_TERM_PATTERNS.map((p) => [p.id, p]));

function ruleFromUnallowableTerm(ruleText: string): string {
  // Order matters: a staff-meals clause also matches the alcohol pattern's "staff meals" alternative.
  if (patternById.get("fines")?.termRule.test(ruleText)) return "R-UNALLOWABLE-FINES";
  if (patternById.get("fundraising")?.termRule.test(ruleText)) return "R-UNALLOWABLE-FUNDRAISING";
  if (patternById.get("lobbying")?.termRule.test(ruleText)) return "R-UNALLOWABLE-LOBBYING";
  if (/alcohol/i.test(ruleText)) return "R-UNALLOWABLE-ALCOHOL_STAFF";
  if (patternById.get("staff_event")?.termRule.test(ruleText)) return "R-UNALLOWABLE-STAFF_EVENT";
  if (patternById.get("alcohol_staff")?.termRule.test(ruleText)) return "R-UNALLOWABLE-ALCOHOL_STAFF";
  return "R-UNALLOWABLE-OTHER";
}

/** Normalize a clause citation: whitespace and the section sign only ("§ 4.2" == "§4.2" == "4.2"). */
export function normalizeClauseRef(ref: string): string {
  return ref.replace(/§/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Exact clause match. The model may cite the whole reference ("GA-2026-114 §4.2; 2 CFR 200.423")
 * or just its primary part ("GA-2026-114 §4.2"); either must equal the extracted term exactly.
 * "HLF-26-031" does NOT match "HLF-26-031 §3.1".
 */
export function clauseRefEquals(cited: string, termRef: string): boolean {
  const a = normalizeClauseRef(cited);
  const b = normalizeClauseRef(termRef);
  if (!a || !b) return false;
  if (a === b) return true;
  const primary = (s: string) => normalizeClauseRef(s.split(";")[0]!);
  return primary(cited) === primary(termRef) && primary(cited).length > 0;
}

/** Concerns that ask for paperwork or a purpose check rather than asserting a prohibition. */
const DOCUMENTATION_QUESTION =
  /document|receipt|invoice|purpose|confirm|clarif|verify|support|backup|justif|attendance|roster|sign-?in|memo|explain|unclear|what (was|is) (this|it) for|which (program|grant)/i;

export function categorizeConcern(
  concern: ConcernInput,
  grants: GrantTerms[],
  txn: Txn,
  /** Grants this line is charged to (bookkeeper) or that Steward proposes. Only their clauses count. */
  chargedGrantIds: (string | null | undefined)[] = [],
): CategorizedConcern {
  const ref = (concern.clauseRef ?? "").trim();
  const own = new Set(chargedGrantIds.filter((x): x is string => !!x));
  const ownGrants = grants.filter((g) => own.has(g.grantId));

  if (ref) {
    for (const g of ownGrants) {
      for (const u of g.unallowable) {
        if (!clauseRefEquals(ref, u.clauseRef)) continue;
        return {
          ruleId: ruleFromUnallowableTerm(u.rule),
          status: concern.status === "blocked" ? "blocked" : "needs_review",
          message: concern.reason,
          evidence: [{ source: "contract", ref: u.clauseRef, note: u.rule }],
        };
      }
      for (const p of g.priorApproval) {
        if (!clauseRefEquals(ref, p.clauseRef)) continue;
        return {
          ruleId: "R-PRIOR-APPROVAL",
          // A purchase that needs the funder's prior approval can't be billed as booked until it is on file
          // (blocked, with a way out: record the approval). A model that only asks whether approval applies
          // (needs_review) stays a question.
          status: concern.status === "blocked" ? "blocked" : "needs_review",
          message: concern.reason,
          evidence: [{ source: "contract", ref: p.clauseRef, note: p.rule }],
        };
      }
    }
    for (const g of ownGrants) {
      const inPeriod = txn.date >= g.periodStart && txn.date <= g.periodEnd;
      if (!inPeriod && normalizeClauseRef(ref).includes(g.grantId)) {
        return {
          ruleId: "R-PERIOD",
          status: concern.status === "blocked" ? "blocked" : "needs_review",
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

  // Not verified against a prohibition of the charged grant: the model's concern is a question
  // for a human, never a block. A cited-but-unmatched clause is not shown as contract evidence.
  const asksForDocs = !!ref || DOCUMENTATION_QUESTION.test(concern.reason);
  return {
    ruleId: asksForDocs ? "R-NEEDS-DOCS" : "R-MODEL-REVIEW",
    status: "needs_review",
    message: concern.reason,
    evidence: [],
  };
}
