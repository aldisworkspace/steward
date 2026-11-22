import { isSoftRule } from "./softRules";
import type { Decision, Finding, GlRow, GrantTerms, StaffAllocation, Txn } from "./types";

/** Grant-charge amount at risk for one non-auto outflow (see demo brief). */
export function atRiskCentsForTxn(
  t: Txn,
  d: Decision,
  gl: GlRow | undefined,
  fs: Finding[],
  staff: StaffAllocation[],
  grants: GrantTerms[],
): number {
  if (d.status === "auto" || t.amountCents >= 0) return 0;

  const abs = Math.abs(t.amountCents);
  const chargedGrant = gl?.class ?? d.grantId;
  const onGrant = !!(chargedGrant || (d.grantId && !d.splits));
  if (!onGrant && !fs.some((f) => f.suggestion?.some((s) => s.grantId))) return 0;

  // Only reconciliation / documentation gaps: the exposure each finding states (e.g. just the
  // difference for an amount mismatch, the full grant charge for a missing receipt).
  if (fs.length && fs.every((f) => isSoftRule(f.ruleId)) && d.status !== "blocked") {
    return Math.min(abs, Math.max(0, ...fs.map((f) => f.exposureCents ?? abs)));
  }

  // "Not allowed" exposure follows the verified decision status, not just the rule id.
  if (d.status === "blocked" && fs.some((f) => f.ruleId.startsWith("R-UNALLOWABLE") || f.ruleId === "R-PERIOD")) {
    if (chargedGrant || d.grantId) return abs;
  }

  const effort = fs.find((f) => f.ruleId === "R-EFFORT");
  if (effort?.exposureCents != null) return Math.min(abs, effort.exposureCents);
  if (effort) {
    const person = staff.find((s) => t.memo.includes(`(${s.employee})`));
    const grantKey = gl?.class && gl.budgetLine ? `${gl.class}:${gl.budgetLine}` : d.grantId && d.budgetLine ? `${d.grantId}:${d.budgetLine}` : null;
    if (person && grantKey) {
      const allowedPct = person.allocation.find((a) => a.key === grantKey)?.pct ?? 0;
      if (allowedPct < 0.999) return Math.round(abs * (1 - allowedPct));
    }
  }

  const overrun = fs.find((f) => f.ruleId === "R-LINE-OVERRUN");
  if (overrun) {
    const g = grants.find((x) => fs.some((f) => f.evidence.some((e) => e.ref.startsWith(x.grantId))));
    const grantId = d.grantId ?? gl?.class;
    const line = d.budgetLine ?? gl?.budgetLine;
    const grant = grants.find((x) => x.grantId === grantId);
    if (grant && line && grant.lineVarianceLimitPct != null) {
      const bl = grant.budgetLines.find((l) => l.code === line);
      if (bl) {
        const cap = Math.round(bl.amount * 100 * (1 + grant.lineVarianceLimitPct / 100));
        const m = overrun.message.match(/to \$(\d[\d,]*\.\d{2})/);
        if (m) {
          const running = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
          return Math.max(0, running - cap);
        }
      }
    }
  }

  if (fs.some((f) => f.ruleId === "R-PRIOR-APPROVAL" || f.ruleId === "R-DUPLICATE")) {
    if (chargedGrant || d.grantId) return abs;
  }

  if (chargedGrant || d.grantId) return abs;
  return 0;
}
