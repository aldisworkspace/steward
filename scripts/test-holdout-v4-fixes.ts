/**
 * Fixes for the false-alarm causes found on hold-out v4 (general principles):
 *  1. receipt threshold inclusivity ("exceeding $75" vs "$75 or more");
 *  2. charges documented by another record (a stipend roster) are exempt from per-payment receipts;
 *  3. a per-unit prior-approval threshold is tested per item, not on the order total.
 * SYNTHETIC inline fixtures, no API calls.
 *   npx tsx scripts/test-holdout-v4-fixes.ts
 */
import assert from "node:assert/strict";
import type { ModelClient } from "../lib/llm";
import { runPipeline } from "../lib/pipeline";
import { maxUnitCostCents, runRules } from "../lib/rules";
import { buildPackage, receiptRequired } from "../lib/tieOut";
import type { Candidate, GlRow, GrantTerms, ReceiptExtract, ReceiptRecord, Txn } from "../lib/types";

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}

const GRANT: GrantTerms = {
  grantId: "WF-1", funder: "Workforce Office (fictional)", program: "Conservation Corps",
  periodStart: "2026-04-01", periodEnd: "2027-03-31", totalAward: 400000,
  budgetLines: [{ code: "C3", name: "Participant support - stipends", amount: 96000 }, { code: "C4", name: "Field supplies", amount: 40000 },
    { code: "C6", name: "Equipment", amount: 20000 }],
  lineVarianceLimitPct: null, unallowable: [],
  priorApproval: [{ rule: "Any item of equipment whose per-unit acquisition cost is $5,000.00 or more", thresholdUsd: 5000, clauseRef: "WF-1 §6.01", perUnit: true }],
  indirectCapPct: null, indirectBase: null, reportDue: null, restrictedPurpose: "Conservation corps training.",
  receiptThresholdUsd: 75, receiptThresholdExclusive: true,
  receiptExemptions: [{ rule: "Corps member stipends are documented by the biweekly stipend roster.", clauseRef: "WF-1 §7.04", costTerms: ["stipend"], documentTerms: ["roster"] }],
};

const gl = (id: string, vendor: string, cents: number, line: string, extra: Partial<Txn> = {}): Txn => ({
  txnId: id, date: "2026-05-06", description: vendor, vendor, amountCents: cents, memo: "", source: "gl", account: "6100 Field Supplies",
  docRef: "", txnType: "Expense", glClass: "WF-1", glBudgetLine: line, enteredBy: "bookkeeper", department: "", ...extra,
});
const rows = (ls: Txn[]): GlRow[] => ls.map((l) => ({ bankRef: l.txnId, date: l.date, description: l.description, amountCents: l.amountCents, account: l.account ?? "", class: "WF-1", budgetLine: l.glBudgetLine ?? null, enteredBy: "bk" }));
const cands = (ls: Txn[]) => new Map<string, Candidate>(ls.map((l) => [l.txnId, { txnId: l.txnId, grantId: "WF-1", budgetLine: l.glBudgetLine ?? null, origin: "gl" }]));
const rules = (ls: Txn[], receipts: ReceiptRecord[] = [], g: GrantTerms = GRANT) =>
  runRules({ txns: ls, gl: rows(ls), staff: [], grants: [g], precedents: [], candidates: cands(ls), receipts, receiptThresholdCents: 7500 });
const rec = (txnId: string, x: ReceiptExtract): ReceiptRecord => ({ receiptId: `R-${txnId}`, fileName: `${txnId}.pdf`, extracted: x, matchedTxnId: txnId, matchScore: 1, matchedBy: "auto" });

check("1. 'exceeding $75': exactly $75.00 needs no receipt, $75.01 does; inclusive by default", () => {
  assert.equal(receiptRequired(7500, GRANT), false);
  assert.equal(receiptRequired(7501, GRANT), true);
  assert.equal(receiptRequired(7500, { ...GRANT, receiptThresholdExclusive: false }), true);
  assert.equal(receiptRequired(7500, { ...GRANT, receiptThresholdExclusive: undefined }), true);
  assert.equal(receiptRequired(7500, { receiptThresholdUsd: null, receiptThresholdExclusive: true }, 7500), true, "exclusivity only with the contract's own threshold");
  const ls = [gl("L1", "Transfer Station", -7500, "C4"), gl("L2", "Transfer Station", -7501, "C4")];
  assert.deepEqual(rules(ls).filter((f) => f.ruleId === "R-RECEIPT-MISSING").map((f) => f.txnId), ["L2"]);
  const p = buildPackage({ grant: GRANT, periodStart: "2026-05-01", periodEnd: "2026-05-31", lines: [ls[0]!], decisions: [], resolutions: [], receipts: [], priorPackages: [] } as never);
  assert.equal(p.checks.find((c) => c.id === "RECEIPTS")!.pass, true);
});

check("2. stipend roster lines are documented by the roster; other stipend-like lines are not", () => {
  const roster = gl("L3", "Corps Member Stipend Roster", -480000, "C3", { account: "6050 Participant Stipends", txnType: "Check" });
  const gear = gl("L4", "Outfitters", -48000, "C3", { memo: "Stipend recipients' boots" });
  assert.deepEqual(rules([roster, gear]).filter((f) => f.ruleId === "R-RECEIPT-MISSING").map((f) => f.txnId), ["L4"]);
});

check("3. per-unit threshold: unit cost from quantity / item text, with tax share", () => {
  const items = (d: string, cents: number, quantity?: number) => ({ description: d, amountCents: cents, ...(quantity ? { quantity } : {}) });
  assert.equal(maxUnitCostCents({ vendor: "V", date: null, totalCents: 616498, purposeText: null, lineItems: [items("Brushcutter", 616498, 5)] }), 123300);
  assert.equal(maxUnitCostCents({ vendor: "V", date: null, totalCents: 616498, purposeText: null, lineItems: [items("5 @ Brushcutter FS-131", 616498)] }), 123300);
  assert.equal(maxUnitCostCents({ vendor: "V", date: null, totalCents: 108000, purposeText: null, lineItems: [items("Saw", 100000)] }), 108000, "tax share included");
  assert.equal(maxUnitCostCents({ vendor: "V", date: null, totalCents: 5000, purposeText: null, lineItems: [] }), null);
  // Tax and delivery printed as their own lines are part of the unit's acquisition cost, not separate units.
  assert.equal(maxUnitCostCents({ vendor: "V", date: null, totalCents: 548585, purposeText: null, lineItems: [
    items("Two-door reach-in refrigerator", 482000, 1), items("Sales tax 9.25%", 44585), items("Delivery & installation", 22000)] }), 548585);
});

check("3. R-PRIOR-APPROVAL per unit: five $1,233 units pass, one $6,000 unit is blocked, no invoice is a question", () => {
  const order = gl("L5", "Power Equipment", -616498, "C4");
  const x = (lineItems: ReceiptExtract["lineItems"], total: number): ReceiptExtract => ({ vendor: "Power Equipment", date: "2026-05-06", totalCents: total, purposeText: null, lineItems });
  const pa = (ls: Txn[], rs: ReceiptRecord[], g = GRANT) => rules(ls, rs, g).filter((f) => f.ruleId === "R-PRIOR-APPROVAL");
  assert.equal(pa([order], [rec("L5", x([{ description: "Brushcutter", amountCents: 616498, quantity: 5 }], 616498))]).length, 0);
  const big = gl("L6", "Power Equipment", -600000, "C6");
  const f = pa([big], [rec("L6", x([{ description: "Chipper", amountCents: 600000, quantity: 1 }], 600000))]);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.status, "blocked");
  const q = pa([order], []);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.status, "needs_review", "per-unit cost unknown without the invoice");
  const total = { ...GRANT, priorApproval: GRANT.priorApproval.map((p) => ({ ...p, perUnit: false })) };
  assert.equal(pa([order], [rec("L5", x([{ description: "Brushcutter", amountCents: 616498, quantity: 5 }], 616498))], total)[0]?.status, "blocked", "an order-total threshold still blocks");
});

async function pipelineChecks() {
  const order = gl("L7", "Power Equipment", -616498, "C4", { memo: "Brushcutters x5" });
  const fake = (concern: object | null): ModelClient => ({
    async json({ content }) {
      const text = (content.find((c) => c.type === "text") as { text: string }).text;
      const rs = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]!) as { txnId: string }[];
      return { data: { codings: rs.map((r) => ({ txnId: r.txnId, grantId: "WF-1", budgetLine: "C4", confidence: 0.8, rationale: "Field supplies.",
        clauseRefs: [], evidenceFit: "consistent", concern })) } as never, usage: { input: 0, output: 0 } };
    },
  });
  const concern = { status: "needs_review", reason: "If one line is a single unit it needs prior approval.", clauseRef: "WF-1 §6.01" };
  const x = (quantity: number | null): ReceiptExtract => ({ vendor: "Power Equipment", date: "2026-05-06", totalCents: 616498, purposeText: null,
    lineItems: [{ description: "Brushcutter", amountCents: 616498, quantity }] });
  const run = (q: number | null) => runPipeline(fake(concern), { txns: [order], gl: rows([order]), staff: [], grants: [GRANT], precedents: [], receipts: [rec("L7", x(q))] });
  const settled = (await run(5)).decisions[0]!;
  assert.equal(settled.status, "auto", settled.ruleHits.join(","));
  assert.ok(settled.checks?.some((c) => c.label === "Question settled"));
  const open = (await run(1)).decisions[0]!;
  assert.notEqual(open.status, "auto", "a single $6,164.98 unit is not settled");
  console.log("ok   3. a model prior-approval question the itemized receipt answers per unit is settled");
}

pipelineChecks().then(() => {
  if (failures) { console.log(`\n${failures} hold-out v4 fix check(s) failed`); process.exit(1); }
  console.log("\nAll hold-out v4 fix checks passed");
}, (e) => { console.log(`FAIL 3. pipeline per-unit question\n     ${(e as Error).message}`); process.exit(1); });
