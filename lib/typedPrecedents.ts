import { vendorKey } from "./vendorKey";
import type { DecisionCheck, Evidence, Finding, GrantTerms, Status, Txn, TypedPrecedent } from "./types";

export function precedentMatchesTxn(p: TypedPrecedent, t: Txn, grantId: string | null): boolean {
  if (p.scope !== "ALL" && p.scope !== (grantId ?? "")) return false;
  if (p.match.txnId && p.match.txnId !== t.txnId) return false;
  if (p.match.vendorKey && vendorKey(t.description) !== p.match.vendorKey) return false;
  return true;
}

const REVIEW_RULES = /^R-(DUPLICATE|PRIOR-APPROVAL|GL-DISAGREE|DEPOSIT-MISMATCH|EFFORT|LINE-OVERRUN|GL-ORPHAN)/;
const BLOCKED_RULES = /^R-(UNALLOWABLE|PURPOSE|PERIOD)/;

export function applyTypedPrecedentsForTxn(args: {
  t: Txn;
  grantId: string | null;
  budgetLine: string | null;
  findings: Finding[];
  concern: { status: Status; reason: string } | null;
  typed: TypedPrecedent[];
  grants: GrantTerms[];
}): {
  findings: Finding[];
  concern: { status: Status; reason: string } | null;
  grantId: string | null;
  budgetLine: string | null;
  checks: DecisionCheck[];
  evidence: Evidence[];
  forcedStatus?: Status;
} {
  const checks: DecisionCheck[] = [];
  const evidence: Evidence[] = [];
  let { findings, concern, grantId, budgetLine } = args;
  let forcedStatus: Status | undefined;

  const matched = args.typed.filter((p) => precedentMatchesTxn(p, args.t, grantId));

  for (const p of matched) {
    const appliedLabel = `Applied ruling of ${p.date} (${p.by.replace(/\s*\(.*\)$/, "")})`;
    checks.push({ ruleId: null, label: "Precedent", message: appliedLabel, tick: "Ⓟ" });
    evidence.push({
      source: "precedent",
      ref: p.id,
      note: `Ruling of ${p.date} by ${p.by}: ${p.note}`,
    });

    if (p.ruling === "allow") {
      const blocked = findings.filter((f) => BLOCKED_RULES.test(f.ruleId));
      findings = findings.filter((f) => !REVIEW_RULES.test(f.ruleId) && !BLOCKED_RULES.test(f.ruleId));
      if (concern?.status === "needs_review") concern = null;
      for (const b of blocked) {
        const clause = b.evidence.find((e) => e.source === "contract")?.ref ?? "contract";
        checks.push({
          ruleId: b.ruleId,
          label: "Precedent vs contract",
          message: `Precedent ${p.id} noted, but ${clause} prohibits this — escalate to funder.`,
          tick: "Ⓒ",
        });
        findings.push(b);
      }
    } else if (p.ruling === "disallow") {
      grantId = null;
      budgetLine = null;
      forcedStatus = "blocked";
    } else if (p.ruling === "prior_approval_granted") {
      findings = findings.filter((f) => f.ruleId !== "R-PRIOR-APPROVAL");
    } else if (p.ruling === "not_duplicate") {
      findings = findings.filter((f) => f.ruleId !== "R-DUPLICATE");
    }
  }

  return { findings, concern, grantId, budgetLine, checks, evidence, forcedStatus };
}
