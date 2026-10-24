import { isInboxResolved } from "./inboxResolved";

export function computeInboxOpenMetrics(args: {
  decisions: { txnId: string; status: string; atRiskCents?: number }[];
  transactions: { txnId: string; amountCents: number }[];
  entries: { txnId: string; state: string }[];
  resolutionTxnIds: Set<string>;
}): { open: number; atRiskCents: number } {
  const byTxn = new Map(args.transactions.map((t) => [t.txnId, t]));
  const exceptions = args.decisions.filter((d) => d.status !== "auto");
  const openExceptions = exceptions.filter(
    (d) => !isInboxResolved(d.txnId, args.entries, args.resolutionTxnIds),
  );
  let atRiskCents = 0;
  for (const d of openExceptions) {
    const t = byTxn.get(d.txnId);
    if (!t || t.amountCents >= 0) continue;
    const risk = d.atRiskCents ?? 0;
    if (risk <= 0) continue;
    atRiskCents += risk;
  }
  return { open: openExceptions.length, atRiskCents };
}
