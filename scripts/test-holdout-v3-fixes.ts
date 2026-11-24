/**
 * Fixes for the precision/recall causes found on hold-out v3 (general principles, no vendor or line special cases):
 *  1. contract receipt exemptions (lease on file) honoured by R-RECEIPT-MISSING and the package RECEIPTS check;
 *  2. the indirect base follows the contract's explicit base / excluded lines (regex only as a fallback);
 *  3. the organization name reaches the coding prompt;
 *  4. R-PRIOR-APPROVAL honours a free-text prior-approval precedent tied to the line;
 *  5. GL-first receipt matching never considers bank lines, and R-PERIOD uses the matched invoice date.
 * (6, the one-cell GL footer, is in test-gl-detail.ts.) SYNTHETIC inline fixtures, fake model, no API calls.
 *   npx tsx scripts/test-holdout-v3-fixes.ts
 */
import assert from "node:assert/strict";
import type { ModelClient } from "../lib/llm";
import { contractReceiptExemption, matchReceipts, type ReceiptInput } from "../lib/matchReceipts";
import { runPipeline } from "../lib/pipeline";
import { indirectRateFindings, runRules } from "../lib/rules";
import { baseLineCodes, buildPackage } from "../lib/tieOut";
import { freeTextPriorApprovalFor } from "../lib/typedPrecedents";
import type { Candidate, GlRow, GrantTerms, Precedent, ReceiptExtract, ReceiptRecord, Txn } from "../lib/types";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}

const GRANT: GrantTerms = {
  grantId: "ST-1", funder: "State Office (fictional)", program: "Adult Case Management",
  periodStart: "2026-07-01", periodEnd: "2027-06-30", totalAward: 300000,
  budgetLines: [
    { code: "A1", name: "Personnel", amount: 150000 }, { code: "A3", name: "Client direct assistance", amount: 40000 },
    { code: "A4", name: "Contract services", amount: 30000 }, { code: "A5", name: "Program supplies", amount: 20000 },
    { code: "A7", name: "Equipment", amount: 10000 }, { code: "A9", name: "Indirect costs", amount: 20000 },
  ],
  lineVarianceLimitPct: null, unallowable: [],
  priorApproval: [{ rule: "Single purchases of $2,500 or more need prior written approval", thresholdUsd: 2500, clauseRef: "ST-1 §7.1" }],
  indirectCapPct: 10, indirectBase: "mtdc", reportDue: null, restrictedPurpose: "Adult case management for newly arrived refugees.",
  billing: { frequency: "monthly", invoiceDueDays: 30, costBasis: "reimbursement" }, receiptThresholdUsd: 150,
  receiptExemptions: [{ rule: "Recurring charges under an executed lease or service agreement on file need no per-payment receipt.",
    clauseRef: "ST-1 §8.2", costTerms: [], documentTerms: ["lease", "service agreement"] }],
};

const gl = (id: string, date: string, vendor: string, cents: number, cls: string | null, line: string | null, extra: Partial<Txn> = {}): Txn => ({
  txnId: id, date, description: vendor, vendor, amountCents: cents, memo: "", source: "gl", account: "6100 Office Supplies",
  docRef: "", txnType: "Expense", glClass: cls, glBudgetLine: line, enteredBy: "bookkeeper", department: "", ...extra,
});
const glRowsOf = (lines: Txn[]): GlRow[] => lines.map((l) => ({ bankRef: l.txnId, date: l.date, description: l.description, amountCents: l.amountCents,
  account: l.account ?? "", class: l.glClass ?? null, budgetLine: l.glBudgetLine ?? null, enteredBy: "bookkeeper" }));
const glCands = (lines: Txn[]) => new Map<string, Candidate>(lines.map((l) => [l.txnId, { txnId: l.txnId, grantId: l.glClass ?? null, budgetLine: l.glBudgetLine ?? null, origin: "gl" }]));
const rx = (vendor: string, date: string, totalCents: number): ReceiptExtract => ({ vendor, date, totalCents, lineItems: [], purposeText: null });

/** Fake model: follows the bookkeeper; optional per-line overrides (concerns, cited precedents). */
function fakeModel(over: Record<string, object> = {}, seen?: { prompt: string }): ModelClient {
  return {
    async json({ content }) {
      const text = (content.find((c) => c.type === "text") as { text: string }).text;
      if (seen) seen.prompt += text;
      const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]!);
      const codings = rows.map((r: { txnId: string; gl: { class: string | null; budgetLine: string | null } | null }) => ({
        txnId: r.txnId, grantId: r.gl?.class ?? null, budgetLine: r.gl?.budgetLine ?? null, confidence: 0.9,
        rationale: "Follows the bookkeeper.", clauseRefs: [], evidenceFit: "consistent", concern: null, ...(over[r.txnId] ?? {}) }));
      return { data: { codings } as never, usage: { input: 0, output: 0 } };
    },
  };
}

async function main() {
  // ---- 1. receipt exemptions
  const rent = gl("L0001", "2026-07-01", "Larchmont Properties LLC", -80000, "ST-1", "A5", { account: "6800 Rent", memo: "Monthly rent - 418 Juniper Ave (lease on file)" });
  const clientRent = gl("L0002", "2026-07-17", "Brookline Court Apartments", -145000, "ST-1", "A3", { account: "6200 Client Direct Assistance", memo: "Client rent assistance - case R-2611", txnType: "Check" });
  const release = gl("L0003", "2026-07-20", "Kestrel Print", -20000, "ST-1", "A5", { memo: "Press release printing" });
  await check("1. exemption: the line must name the agreement (lease), not just the cost (rent)", () => {
    assert.ok(contractReceiptExemption(rent, GRANT));
    assert.equal(contractReceiptExemption(clientRent, GRANT), null, "client rent assistance is not a lease payment");
    assert.equal(contractReceiptExemption(release, GRANT), null, "\"release\" is not \"lease\"");
    assert.equal(contractReceiptExemption(rent, { ...GRANT, receiptExemptions: null }), null);
    const rentOnly = { ...GRANT, receiptExemptions: [{ rule: "Rent paid under the lease on file", clauseRef: "X §5.1", costTerms: ["rent"], documentTerms: ["lease"] }] };
    assert.ok(contractReceiptExemption(rent, rentOnly));
    assert.equal(contractReceiptExemption(gl("L9", "2026-07-02", "Copier Co", -30000, "ST-1", "A5", { memo: "copier lease payment" }), rentOnly), null, "cost term required when stated");
  });
  await check("1. R-RECEIPT-MISSING skips exempt lines; still fires on the client rent check without a receipt", () => {
    const lines = [rent, clientRent, release];
    const fs = runRules({ txns: lines, gl: glRowsOf(lines), staff: [], grants: [GRANT], precedents: [], candidates: glCands(lines), receipts: [], receiptThresholdCents: 7500 });
    const missing = fs.filter((f) => f.ruleId === "R-RECEIPT-MISSING").map((f) => f.txnId).sort();
    assert.deepEqual(missing, ["L0002", "L0003"]);
  });
  await check("1. package RECEIPTS check honours the exemption", () => {
    const lines = [rent];
    const p = buildPackage({ grant: GRANT, periodStart: "2026-07-01", periodEnd: "2026-07-31", lines, decisions: [], resolutions: [], receipts: [], priorPackages: [] } as never);
    const r = p.checks.find((c) => c.id === "RECEIPTS")!;
    assert.equal(r.pass, true, r.detail);
    const p2 = buildPackage({ grant: { ...GRANT, receiptExemptions: undefined }, periodStart: "2026-07-01", periodEnd: "2026-07-31", lines, decisions: [], resolutions: [], receipts: [], priorPackages: [] } as never);
    assert.equal(p2.checks.find((c) => c.id === "RECEIPTS")!.pass, false);
  });

  // ---- 2. indirect base
  await check("2. explicit base lines / exclusions win over the line-name regex", () => {
    assert.ok(baseLineCodes(GRANT, "mtdc", "A9").includes("A3"), "regex fallback keeps 'Client direct assistance' (the old bug)");
    assert.deepEqual(baseLineCodes({ ...GRANT, indirectExcludedLines: ["A3", "A7"] }, "mtdc", "A9"), ["A1", "A4", "A5"]);
    assert.deepEqual(baseLineCodes({ ...GRANT, indirectBaseLines: ["A1", "A4", "A5", "A9", "ZZ"] }, "mtdc", "A9"), ["A1", "A4", "A5"]);
  });
  await check("2. R-INDIRECT-RATE on the contract's MTDC: correct JE is clean, a JE on total direct costs is blocked for the excess only", () => {
    const g = { ...GRANT, indirectBaseLines: ["A1", "A4", "A5"], indirectExcludedLines: ["A3", "A7"] };
    const base = [
      gl("L0010", "2026-09-10", "R. Haddad", -500000, "ST-1", "A1", { txnType: "Paycheck" }),
      gl("L0011", "2026-09-12", "Brookline Court Apartments", -145000, "ST-1", "A3", { txnType: "Check" }),
      gl("L0012", "2026-09-14", "Lumen Interpreting", -100000, "ST-1", "A4"),
      gl("L0013", "2026-09-15", "Corvane Computers", -300000, "ST-1", "A7"),
    ];
    const je = (cents: number) => gl("L0020", "2026-09-30", "", cents, "ST-1", "A9", { txnType: "Journal Entry", docRef: "JE-IDC-09", account: "6900 Indirect Cost Allocation" });
    const run = (lines: Txn[]) => indirectRateFindings({ txns: lines, gl: [], staff: [], grants: [g], precedents: [], candidates: new Map() });
    assert.equal(run([...base, je(-60000)]).length, 0, "10% × (5,000 + 1,000) = 600.00");
    const f = run([...base, je(-104500)]);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.status, "blocked");
    assert.equal(f[0]!.exposureCents, 44500, "1,045.00 booked on all direct costs − 600.00 allowed");
  });

  // ---- 3. organization name
  await check("3. organization name is in the coding context", async () => {
    const seen = { prompt: "" };
    const line = gl("L0030", "2026-08-11", "Hollis Business Machines", -12000, "ST-1", "A5");
    await runPipeline(fakeModel({}, seen), { txns: [line], gl: glRowsOf([line]), staff: [], grants: [GRANT], precedents: [], organizationName: "Cedar Hollow Welcome Center (fictional)" });
    assert.match(seen.prompt, /"organization":"Cedar Hollow Welcome Center \(fictional\)"/);
    const none = { prompt: "" };
    await runPipeline(fakeModel({}, none), { txns: [line], gl: glRowsOf([line]), staff: [], grants: [GRANT], precedents: [] });
    assert.doesNotMatch(none.prompt, /"organization"/);
  });

  // ---- 4. prior approval precedents
  const approval: Precedent = { id: "P1", date: "2026-07-22", by: "D. Varga, Contract Officer (fictional)", scope: "ST-1:A7",
    ruling: "Prior written approval PA-2026-03 granted for purchase of one multifunction copier/printer, not to exceed $3,000.00 including delivery and setup, chargeable to line A7." };
  const copier = gl("L0040", "2026-08-11", "Hollis Business Machines", -286814, "ST-1", "A7", { account: "6600 Equipment", memo: "MFP copier - prior approval ltr PA-2026-03" });
  const laptops = gl("L0041", "2026-09-14", "Corvane Computers", -337516, "ST-1", "A7", { account: "6600 Equipment", memo: "Laptops - case management team" });
  const cheapLaptop = gl("L0042", "2026-09-20", "Corvane Computers", -260000, "ST-1", "A7", { account: "6600 Equipment", memo: "Laptop" });
  await check("4. free-text approval: scope, cap, tie to the line, denial wording", () => {
    const charged = [{ grantId: "ST-1", budgetLine: "A7" }];
    assert.equal(freeTextPriorApprovalFor(approval, copier, charged), true, "memo quotes PA-2026-03");
    assert.equal(freeTextPriorApprovalFor(approval, laptops, charged, ["P1"]), false, "over the $3,000 cap even if cited");
    assert.equal(freeTextPriorApprovalFor(approval, cheapLaptop, charged), false, "not tied to this approval");
    assert.equal(freeTextPriorApprovalFor(approval, cheapLaptop, charged, ["P1"]), true, "the model cited it");
    assert.equal(freeTextPriorApprovalFor(approval, copier, [{ grantId: "ST-1", budgetLine: "A5" }]), false, "line-scoped ruling");
    assert.equal(freeTextPriorApprovalFor({ ...approval, scope: "ST-1" }, copier, [{ grantId: "OTHER", budgetLine: "A7" }]), false, "other grant");
    const denial = { ...approval, scope: "ST-1", ruling: "No prior written approval has been requested or granted for any equipment purchase under ST-1 §7.2 as of this date." };
    assert.equal(freeTextPriorApprovalFor(denial, { ...copier, memo: "ST-1 §7.2" }, charged, ["P1"]), false, "a statement that none was granted");
    const grantIdOnly = { ...approval, ruling: "Prior written approval granted under ST-1 for equipment, not to exceed $3,000.00." , scope: "ST-1" };
    assert.equal(freeTextPriorApprovalFor(grantIdOnly, { ...cheapLaptop, memo: "Laptop ST-1" }, [{ grantId: "ST-1", budgetLine: "A7" }]), false, "a grant id is not an approval reference");
  });
  await check("4. pipeline: the approved copier is clean; the laptops over the cap stay blocked", async () => {
    const lines = [copier, laptops];
    const res = await runPipeline(fakeModel(), { txns: lines, gl: glRowsOf(lines), staff: [], grants: [GRANT], precedents: [approval] });
    const d = (id: string) => res.decisions.find((x) => x.txnId === id)!;
    assert.ok(!d("L0040").ruleHits.includes("R-PRIOR-APPROVAL"), d("L0040").ruleHits.join(","));
    assert.equal(d("L0040").status, "auto");
    assert.equal(d("L0040").grantId, "ST-1");
    assert.ok(d("L0040").evidence.some((e) => e.source === "precedent" && e.ref === "P1"));
    assert.equal(d("L0041").status, "blocked");
    assert.ok(d("L0041").ruleHits.includes("R-PRIOR-APPROVAL"));
  });
  await check("4. the model's own prior-approval concern is cleared with the finding", async () => {
    const res = await runPipeline(fakeModel({ L0040: { concern: { status: "blocked", reason: "Equipment over $2,500 needs prior approval.", clauseRef: "ST-1 §7.1" } } }),
      { txns: [copier], gl: glRowsOf([copier]), staff: [], grants: [GRANT], precedents: [approval] });
    assert.equal(res.decisions[0]!.status, "auto", res.decisions[0]!.ruleHits.join(","));
  });

  // ---- 5. GL-first receipt matching + R-PERIOD on the invoice date
  const bill = gl("L0050", "2026-07-09", "Meridian Language Partners", -86500, "ST-1", "A4", { txnType: "Bill", docRef: "MLP-0617", memo: "Interpretation services inv MLP-0617" });
  const bankPlaceholder: Txn = { txnId: "B0011", date: "2026-07-24", description: "BILL PMT MERIDIAN LANGUAGE PARTNERS", amountCents: -86500, memo: "Inv MLP-0617", source: "bank" };
  await check("5. GL-first: a bank placeholder is never a receipt candidate (no tie with the GL line)", () => {
    const r: ReceiptInput = { receiptId: "RM", extracted: rx("Meridian Language Partners", "2026-06-30", 86500), matchedTxnId: null, matchedBy: null };
    const m = matchReceipts([r], [bill, bankPlaceholder]).get("RM")!;
    assert.equal(m.matchedTxnId, "L0050");
    assert.deepEqual(m.candidates, []);
    // Bank-first workspaces are unchanged: bank transactions are the lines.
    const bankFirst: Txn = { txnId: "T0001", date: "2026-07-01", description: "Office Depot", amountCents: -4599, memo: "" };
    assert.equal(matchReceipts([{ ...r, receiptId: "RB", extracted: rx("Office Depot", "2026-07-01", 4599) }], [bankFirst]).get("RB")!.matchedTxnId, "T0001");
  });
  await check("5. R-PERIOD fires on a GL line booked in period when its invoice is dated before the period", async () => {
    const recs: ReceiptRecord[] = [{ receiptId: "RM", fileName: "2026-06-30_meridian-language.pdf", extracted: rx("Meridian Language Partners", "2026-06-30", 86500), matchedTxnId: "L0050", matchScore: 0.7, matchedBy: "auto" }];
    const lines = [bill, bankPlaceholder];
    const fs = runRules({ txns: lines, gl: glRowsOf([bill]), staff: [], grants: [GRANT], precedents: [], candidates: glCands([bill]), receipts: recs });
    const f = fs.find((x) => x.ruleId === "R-PERIOD" && x.txnId === "L0050");
    assert.ok(f, fs.map((x) => x.ruleId).join(","));
    assert.equal(f!.status, "blocked");
    const res = await runPipeline(fakeModel(), { txns: lines, gl: glRowsOf([bill]), staff: [], grants: [GRANT], precedents: [], receipts: recs });
    const d = res.decisions.find((x) => x.txnId === "L0050")!;
    assert.equal(d.status, "blocked");
    assert.equal(d.atRiskCents, 86500);
    // An in-period invoice date raises nothing.
    const ok = runRules({ txns: lines, gl: glRowsOf([bill]), staff: [], grants: [GRANT], precedents: [], candidates: glCands([bill]),
      receipts: [{ ...recs[0]!, extracted: rx("Meridian Language Partners", "2026-07-08", 86500) }] });
    assert.equal(ok.filter((x) => x.ruleId === "R-PERIOD").length, 0);
  });

  if (failures) { console.log(`\n${failures} hold-out v3 fix check(s) failed`); process.exit(1); }
  console.log("\nAll hold-out v3 fix checks passed");
}
main();
