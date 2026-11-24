/**
 * Optional bank reconciliation for GL-first workspaces (SYNTHETIC inline fixtures, no model calls).
 *   npx tsx scripts/test-reconcile.ts
 */
import assert from "node:assert/strict";
import type { ModelClient } from "../lib/llm";
import { reconcileGlToBank } from "../lib/matchLedger";
import { runPipeline } from "../lib/pipeline";
import { runRules } from "../lib/rules";
import type { BankLine, Candidate, GlRow, Txn } from "../lib/types";
import { FIXTURE_GRANTS } from "./fixtures";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}

const gl = (id: string, date: string, vendor: string, cents: number, cls: string | null, line: string | null, extra: Partial<Txn> = {}): Txn => ({
  txnId: id, date, description: vendor, vendor, amountCents: cents, memo: "", source: "gl", account: "6100 Office Supplies",
  docRef: "", txnType: "Expense", glClass: cls, glBudgetLine: line, enteredBy: "bookkeeper", department: "", ...extra,
});
const bank = (id: string, date: string, desc: string, cents: number): BankLine => ({ lineId: id, date, description: desc, amountCents: cents, memo: "" });

const LINES: Txn[] = [
  gl("L0001", "2026-07-02", "Office Depot", -12345, "GA-2026-114", "A3"),                       // exact
  gl("L0002", "2026-07-05", "Lakeshore Learning", -30000, "HLF-26-031", "B2", { docRef: "1050" }), // split payment (group)
  gl("L0003", "2026-07-05", "Lakeshore Learning", -20000, "GA-2026-114", "A3", { docRef: "1050" }),
  gl("L0004", "2026-07-08", "Golden Gate Charter", -240000, "HLF-26-031", "B3"),               // near: bank 2,400.01
  gl("L0005", "2026-07-10", "Comcast", -12999, null, null),                                     // no bank line, unrestricted
  gl("L0006", "2026-07-12", "Scholastic", -45000, "HLF-26-031", "B2"),                          // no bank line, grant
  gl("L0007", "2026-07-15", "Indirect allocation", -50000, "GA-2026-114", "A6", { txnType: "Journal Entry" }), // non-cash
  gl("L0008", "2026-07-15", "Maria Lopez", -150000, "GA-2026-114", "A1", { account: "6000 Salaries & Wages" }), // payroll
  gl("L0009", "2026-08-20", "Office Depot", -5000, "GA-2026-114", "A3"),                        // after statement end
];
const BANK: BankLine[] = [
  bank("B0001", "2026-07-03", "OFFICE DEPOT #2231", -12345),
  bank("B0002", "2026-07-06", "LAKESHORE LEARNING MAT", -50000),
  bank("B0003", "2026-07-08", "GOLDEN GATE CHARTER BUS", -240001),
  bank("B0004", "2026-07-20", "SQ *UNKNOWN CAFE", -4321),
  bank("B0005", "2026-07-21", "STATE GRANT DEPOSIT", 100000),
  bank("B0006", "2026-07-31", "MONTHLY SERVICE FEE", -1500),
];
const glRows: GlRow[] = LINES.map((l) => ({ bankRef: l.txnId, date: l.date, description: l.description, amountCents: l.amountCents,
  account: l.account!, class: l.glClass ?? null, budgetLine: l.glBudgetLine ?? null, enteredBy: "bookkeeper" }));
const placeholders: Txn[] = [BANK[3]!, BANK[5]!].map((b) => ({ txnId: b.lineId, date: b.date, description: b.description, amountCents: b.amountCents, memo: "", source: "bank" }));

async function main() {
  await check("matcher tiers: exact, split payment, near; unrecorded outflows only", () => {
    const r = reconcileGlToBank(LINES, BANK);
    assert.equal(r.matches.get("L0001")?.tier, "exact");
    assert.equal(r.matches.get("L0002")?.tier, "group");
    assert.equal(r.matches.get("L0003")?.bankLineId, "B0002");
    assert.equal(r.matches.get("L0004")?.tier, "near");
    assert.equal(r.matches.has("L0005"), false);
    assert.deepEqual(r.unrecorded.map((b) => b.lineId), ["B0004", "B0006"], "deposits are not 'unrecorded outflows'");
    assert.equal(r.statementStart, "2026-07-03");
    assert.equal(r.statementEnd, "2026-07-31");
  });

  const candidates = new Map<string, Candidate>([...LINES, ...placeholders].map((t) =>
    [t.txnId, { txnId: t.txnId, grantId: t.glClass ?? null, budgetLine: t.glBudgetLine ?? null, origin: "gl" as const }]));
  const findings = runRules({ txns: [...LINES, ...placeholders], gl: glRows, staff: [], grants: FIXTURE_GRANTS, precedents: [], candidates, bankLines: BANK });
  const by = (id: string, rule: string) => findings.find((f) => f.txnId === id && f.ruleId === rule);

  await check("R-BANK-UNRECORDED on unmatched bank outflows, at-risk 0", () => {
    const f = by("B0004", "R-BANK-UNRECORDED");
    assert.ok(f);
    assert.equal(f.status, "needs_review");
    assert.equal(f.exposureCents, 0);
    assert.ok(by("B0006", "R-BANK-UNRECORDED"));
  });
  await check("R-GL-NO-BANK: grant line exposed in full, unrestricted 0, skips JE/payroll/after statement", () => {
    assert.equal(by("L0006", "R-GL-NO-BANK")?.exposureCents, 45000);
    assert.equal(by("L0005", "R-GL-NO-BANK")?.exposureCents, 0);
    assert.equal(by("L0007", "R-GL-NO-BANK"), undefined, "journal entry never hits the bank");
    assert.equal(by("L0008", "R-GL-NO-BANK"), undefined, "payroll reconciles separately");
    assert.equal(by("L0009", "R-GL-NO-BANK"), undefined, "after the statement end");
    assert.equal(by("L0001", "R-GL-NO-BANK"), undefined);
    assert.equal(by("L0002", "R-GL-NO-BANK"), undefined, "split payment matched as a group");
  });
  await check("R-AMOUNT-MISMATCH: one cent, exposure = difference", () => {
    const f = by("L0004", "R-AMOUNT-MISMATCH");
    assert.ok(f);
    assert.equal(f.exposureCents, 1);
    assert.equal(f.status, "needs_review");
  });
  await check("no reconciliation rules without a bank file", () => {
    const none = runRules({ txns: LINES, gl: glRows, staff: [], grants: FIXTURE_GRANTS, precedents: [], candidates });
    assert.equal(none.filter((f) => /BANK|AMOUNT-MISMATCH/.test(f.ruleId)).length, 0);
  });

  await check("pipeline: placeholders not sent to the model; statuses and at-risk", async () => {
    const seen: string[] = [];
    const fake: ModelClient = {
      async json({ content }) {
        const text = (content.find((c) => c.type === "text") as { text: string }).text;
        const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]!);
        seen.push(...rows.map((r: { txnId: string }) => r.txnId));
        const codings = rows.map((r: { txnId: string; gl: { class: string | null; budgetLine: string | null } | null }) => ({
          txnId: r.txnId, grantId: r.gl?.class ?? null, budgetLine: r.gl?.budgetLine ?? null, confidence: 0.9,
          rationale: "Follows the bookkeeper.", clauseRefs: [], concern: null }));
        return { data: { codings } as never, usage: { input: 0, output: 0 } };
      },
    };
    const res = await runPipeline(fake, { txns: [...LINES, ...placeholders], gl: glRows, staff: [], grants: FIXTURE_GRANTS, precedents: [], bankLines: BANK });
    assert.equal(seen.includes("B0004"), false, "bank placeholder must not reach the model");
    assert.equal(seen.includes("L0001"), true);
    const d = (id: string) => res.decisions.find((x) => x.txnId === id)!;
    assert.equal(d("B0004").status, "needs_review");
    assert.equal(d("B0004").atRiskCents, 0);
    assert.deepEqual(d("B0004").ruleHits, ["R-BANK-UNRECORDED"]);
    assert.equal(d("L0004").atRiskCents, 1, "mismatch exposes only the difference");
    assert.equal(d("L0006").atRiskCents, 45000);
    assert.equal(d("L0005").atRiskCents, 0);
    assert.equal(d("L0001").status, "auto");
    assert.notEqual(d("L0004").status, "blocked");
  });

  await check("payroll lines of one pay date sum to the ACH; bills clear later by check; duplicate bill entry", () => {
    const pay = (id: string, who: string, cents: number, cls: string | null) =>
      gl(id, "2026-07-03", who, cents, cls, cls ? "A1" : null, { txnType: "Paycheck", docRef: `DD${id}`, account: "6010 Salaries & Wages" });
    const lines = [
      pay("P1", "Ana Ruiz", -100000, "GA-2026-114"), pay("P2", "Ana Ruiz", -50000, null), pay("P3", "Bo Li", -80000, "GA-2026-114"),
      gl("R1", "2026-09-01", "Corliss Holdings", -250000, "GA-2026-114", "A3", { txnType: "Bill", docRef: "NC-9" }),
      gl("R2", "2026-09-01", "Corliss Holdings", -125000, null, null, { txnType: "Bill", docRef: "NC-9" }),
      gl("Q1", "2026-08-26", "Quill Eval", -125000, "HLF-26-031", "B4", { txnType: "Bill", docRef: "Q-1" }),
      gl("D1", "2026-08-19", "Alder Print", -31767, "GA-2026-114", "A3", { txnType: "Bill", docRef: "4471" }),
      gl("D2", "2026-08-20", "Alder Print", -31767, "GA-2026-114", "A3", { txnType: "Bill", docRef: "4471" }),
    ];
    const bankLines = [
      bank("B1", "2026-07-03", "PAYROLL SVC ACH DEBIT", -230000),
      bank("B2", "2026-08-28", "CHECK 10448", -31767),
      bank("B3", "2026-09-02", "CHECK 10451", -125000),
      bank("B4", "2026-09-09", "CHECK 10443", -375000),
    ];
    const r = reconcileGlToBank(lines, bankLines);
    assert.deepEqual(["P1", "P2", "P3"].map((id) => r.matches.get(id)?.bankLineId), ["B1", "B1", "B1"]);
    assert.equal(r.matches.get("Q1")?.bankLineId, "B3", "a single-line bill, not half of the rent bill");
    assert.deepEqual([r.matches.get("R1")?.bankLineId, r.matches.get("R2")?.bankLineId], ["B4", "B4"]);
    assert.equal(r.matches.get("D2")?.bankLineId, "B2");
    assert.equal(r.matches.has("D1"), false, "the second entry of the same invoice was never paid");
    assert.deepEqual(r.unrecorded, []);
  });

  if (failures) { console.log(`\n${failures} reconciliation check(s) failed`); process.exit(1); }
  console.log("\nAll reconciliation checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
