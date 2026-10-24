export function isInboxResolved(
  txnId: string,
  entries: { txnId: string; state: string }[],
  resolvedTxnIds: Set<string>,
): boolean {
  const entry = entries.find((e) => e.txnId === txnId);
  if (entry && (entry.state === "approved" || entry.state === "rejected")) return true;
  return resolvedTxnIds.has(txnId);
}
