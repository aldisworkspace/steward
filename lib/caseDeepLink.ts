/** Resolve marketing deep links (?case=black-cat or ?vendor=...) to a txn id after data loads. */
export function resolveCaseDeepLink(
  param: string,
  ledger: { txnId: string; description: string }[],
  notAllowedTxnIds: string[],
): string | null {
  const trimmed = param.trim();
  if (!trimmed) return null;

  if (/^T\d+/i.test(trimmed)) {
    return ledger.some((r) => r.txnId === trimmed) ? trimmed : null;
  }

  const needle = trimmed.replace(/-/g, " ").trim();
  const upper = needle.toUpperCase();
  const hit = ledger.find(
    (r) =>
      r.description.toUpperCase().includes(upper) ||
      upper.split(/\s+/).every((w) => r.description.toUpperCase().includes(w)),
  );
  if (hit) return hit.txnId;

  return notAllowedTxnIds[0] ?? null;
}
