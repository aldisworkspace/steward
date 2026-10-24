export function caseNarrative(args: {
  bankNote?: string;
  glNote?: string;
  bkLabel: string | null;
  stewardLabel: string;
  status: string;
  actionHint: string;
}): { happened: string; stewardDid: string; youNeed: string } {
  const happened =
    args.bankNote && args.glNote
      ? `${args.bankNote} Bookkeeper coded it as ${args.bkLabel ?? "unknown"}.`
      : args.bankNote ?? "Bank and ledger facts are on file for this charge.";
  const stewardDid =
    args.bkLabel && args.stewardLabel !== args.bkLabel
      ? `Steward would code ${args.stewardLabel} instead of the bookkeeper's ${args.bkLabel}.`
      : `Steward's coding: ${args.stewardLabel}.`;
  const youNeed =
    args.status === "blocked"
      ? "Confirm moving this off grant funds or override with a documented reason."
      : args.actionHint;
  return { happened, stewardDid, youNeed };
}
