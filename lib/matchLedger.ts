import type { GlRow, Txn } from "./types";

function daysBetween(a: string, b: string) {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

function tokenOverlap(a: string, b: string) {
  const ta = new Set(a.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const tb = new Set(b.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
  let n = 0;
  for (const w of ta) if (tb.has(w)) n++;
  return n;
}

export type LedgerCsvRow = {
  date: string;
  description: string;
  amountCents: number;
  account: string;
  class: string | null;
  budgetLine: string | null;
  enteredBy: string;
};

export function matchLedgerToBank(
  ledgerRows: LedgerCsvRow[],
  txns: Txn[],
): { gl: GlRow[]; orphanFindings: { description: string; date: string; amountCents: number }[] } {
  const used = new Set<string>();
  const gl: GlRow[] = [];

  for (const row of ledgerRows) {
    let best: Txn | null = null;
    let bestScore = -1;
    for (const t of txns) {
      if (used.has(t.txnId)) continue;
      if (t.amountCents !== row.amountCents) continue;
      const dd = daysBetween(t.date, row.date);
      if (dd > 3) continue;
      let score = 10 - dd;
      score += tokenOverlap(t.description, row.description) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      used.add(best.txnId);
      gl.push({
        bankRef: best.txnId,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        account: row.account,
        class: row.class,
        budgetLine: row.budgetLine,
        enteredBy: row.enteredBy,
      });
    }
  }

  const orphanFindings = ledgerRows
    .filter((row) => {
      const matched = gl.some(
        (g) => g.amountCents === row.amountCents && g.date === row.date && g.description === row.description,
      );
      return !matched;
    })
    .map((row) => ({
      description: row.description,
      date: row.date,
      amountCents: row.amountCents,
    }));

  return { gl, orphanFindings };
}

export function suggestLedgerMapping(headers: string[]) {
  const norm = (h: string) => h.trim().toLowerCase();
  const pick = (syns: string[]) => headers.find((h) => syns.some((s) => norm(h).includes(s))) ?? null;
  return {
    date: pick(["date", "posting"]),
    description: pick(["description", "name", "payee", "memo"]),
    amount: pick(["amount", "net"]),
    class: pick(["class", "fund", "grant"]),
    account: pick(["account", "split"]),
    budgetLine: pick(["budget", "line", "program"]),
    enteredBy: pick(["entered", "user", "by"]),
  };
}
