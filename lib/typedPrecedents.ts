import { vendorKey } from "./vendorKey";
import type { DecisionCheck, Evidence, Finding, GrantTerms, Precedent, Status, Txn, TypedPrecedent } from "./types";

/** A ruling scoped to a grant applies to a line charged to it, by the bookkeeper or by Steward. */
export function precedentMatchesTxn(p: TypedPrecedent, t: Txn, grantId: string | null, alsoCharged: (string | null | undefined)[] = []): boolean {
  if (p.scope !== "ALL" && p.scope !== (grantId ?? "") && !alsoCharged.some((g) => !!g && g === p.scope)) return false;
  if (p.match.txnId && p.match.txnId !== t.txnId) return false;
  if (p.match.vendorKey && vendorKey(t.description) !== p.match.vendorKey) return false;
  return true;
}

const APPROVAL_GRANTED = /\b(prior|written|advance)\b[^.]{0,40}\bapproval\b[^.]{0,80}\b(granted|given|issued|on file)\b|\b(approves|approved|granted)\b[^.]{0,40}\b(prior|written)\b[^.]{0,20}\bapproval\b/i;
const APPROVAL_DENIED = /\b(denied|declined|rejected|withdrawn|revoked|not (granted|approved))\b|\b(no|not|never|without|neither)\b[^.]{0,30}\bapproval\b/i;
const CAP = /\b(?:not to exceed|up to|no more than|maximum of|capped at|limit of)\s*\$\s?([\d,]+(?:\.\d{1,2})?)/i;
const REF_TOKEN = /\b[A-Z]{1,6}-\d{2,4}(?:-\d{1,4})*\b/g;

/**
 * A free-text funder ruling that grants prior approval and covers this line: approval wording (not a denial),
 * scoped to ALL, the charged grant, or the charged grant:line; the line is within any "not to exceed $X" cap; and
 * the line is tied to that approval — its memo or description quotes the approval's reference (e.g. "PA-2026-03"),
 * or the model cited the precedent for this line. Without a tie an approval for one purchase never clears another.
 */
export function freeTextPriorApprovalFor(
  p: Precedent, t: Txn, charged: { grantId: string | null | undefined; budgetLine: string | null | undefined }[], citedIds: string[] = [],
): boolean {
  if (!APPROVAL_GRANTED.test(p.ruling) || APPROVAL_DENIED.test(p.ruling)) return false;
  const scope = p.scope.trim();
  const inScope = scope === "ALL" || charged.some((c) => !!c.grantId && (scope === c.grantId || (!!c.budgetLine && scope === `${c.grantId}:${c.budgetLine}`)));
  if (!inScope) return false;
  const cap = p.ruling.match(CAP);
  if (cap && -t.amountCents > Math.round(parseFloat(cap[1]!.replace(/,/g, "")) * 100)) return false;
  // Approval references only: a grant or award id in the ruling ties every line of that grant, so it never counts.
  const refs = (p.ruling.match(REF_TOKEN) ?? []).filter((r) => !scope.includes(r) && !charged.some((c) => !!c.grantId && c.grantId.includes(r)));
  const text = `${t.description} ${t.memo}`;
  const quoted = refs.some((r) => new RegExp(`\\b${r}\\b`).test(text));
  return quoted || citedIds.includes(p.id);
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
  /** Other grants the line is charged to (the bookkeeper's claim, the model's proposal) for grant-scoped rulings. */
  chargedGrantIds?: (string | null | undefined)[];
  /** Free-text rulings (precedents.json, older records): honoured for prior approval, see freeTextPriorApprovalFor. */
  untyped?: Precedent[];
  /** Grant:line pairs the line is charged to (bookkeeper, model) for line-scoped free-text rulings. */
  chargedLines?: { grantId: string | null | undefined; budgetLine: string | null | undefined }[];
  /** Precedent ids the model cited for this line. */
  citedPrecedentIds?: string[];
  /** The rule the model's concern was verified as (categorizeConcern), so an approval clears that concern too. */
  concernRuleId?: string | null;
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

  const matched = args.typed.filter((p) => precedentMatchesTxn(p, args.t, grantId, args.chargedGrantIds));

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
      // The funder's written approval covers a purchase over the threshold and a budget change over a line cap.
      ({ findings, concern } = clearApproval(findings, concern, ["R-PRIOR-APPROVAL", "R-LINE-OVERRUN"], args.concernRuleId));
    } else if (p.ruling === "not_duplicate") {
      findings = findings.filter((f) => f.ruleId !== "R-DUPLICATE");
    }
  }

  if (findings.some((f) => f.ruleId === "R-PRIOR-APPROVAL")) {
    const charged = [{ grantId, budgetLine }, ...(args.chargedLines ?? [])];
    const approval = (args.untyped ?? []).find((p) => freeTextPriorApprovalFor(p, args.t, charged, args.citedPrecedentIds));
    if (approval) {
      ({ findings, concern } = clearApproval(findings, concern, ["R-PRIOR-APPROVAL"], args.concernRuleId));
      checks.push({ ruleId: null, label: "Precedent", message: `Prior approval on file: ruling of ${approval.date} (${approval.by.replace(/\s*,.*$/, "")})`, tick: "Ⓟ" });
      evidence.push({ source: "precedent", ref: approval.id, note: `Ruling of ${approval.date} by ${approval.by}: ${approval.ruling}` });
    }
  }

  return { findings, concern, grantId, budgetLine, checks, evidence, forcedStatus };
}

/** Drop approval findings; the model's own concern goes too when it was the same prior-approval question. */
function clearApproval(findings: Finding[], concern: { status: Status; reason: string } | null, ruleIds: string[], concernRuleId?: string | null) {
  const removed = findings.filter((f) => ruleIds.includes(f.ruleId));
  const kept = findings.filter((f) => !ruleIds.includes(f.ruleId));
  const sameConcern = !!concern && (removed.some((f) => f.message === concern.reason) || (!!concernRuleId && ruleIds.includes(concernRuleId)));
  return { findings: kept, concern: sameConcern ? null : concern };
}
