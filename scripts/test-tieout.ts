/**
 * Billing package penny tie-outs (pure, SYNTHETIC inline fixtures):
 * sum off by one cent, indirect half-cent rounding, cumulative over budget, out of period,
 * resolved exception, excluded unallowable listed, receipts, CSV export ties to the snapshot.
 *   npx tsx scripts/test-tieout.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packageCsv } from "../lib/packageCsv";
import { parseGlDetail } from "../lib/parseGlDetail";
import { applyRate, billingPeriods, buildPackage, type BuildPackageInput, type TieOutDecision } from "../lib/tieOut";
import type { Txn } from "../lib/types";
import { FIXTURE_GRANTS_V2 } from "./fixturesV2";

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}
const CITY = FIXTURE_GRANTS_V2[0]!;
const gl = (id: string, date: string, vendor: string, cents: number, line: string | null, extra: Partial<Txn> = {}): Txn => ({
  txnId: id, date, description: vendor, vendor, amountCents: cents, memo: "", source: "gl", account: "6100 Supplies", docRef: "",
  txnType: "Expense", glClass: line ? "FS-27-0412" : null, glBudgetLine: line, enteredBy: "bookkeeper", department: "",
  programApprovedBy: "M. Chen (Program Director)", ...extra,
});
const auto = (t: Txn): TieOutDecision => ({ txnId: t.txnId, grantId: t.glClass ?? null, budgetLine: t.glBudgetLine ?? null, status: "auto", ruleHits: [] });

function base(): BuildPackageInput {
  const lines = [
    gl("L1", "2026-07-03", "Anthony Ortega", -100005, "C1", { txnType: "Paycheck", account: "6010 Salaries & Wages" }),
    gl("L2", "2026-07-17", "Erin Smith", -23450, "C1", { txnType: "Paycheck", account: "6010 Salaries & Wages" }),
    gl("L3", "2026-07-31", "Indirect allocation", -12346, "C7", { txnType: "Journal Entry", account: "6900 Indirect" }),
    gl("L4", "2026-07-09", "Office Depot", -8000, "C3"),
    gl("L5", "2026-07-12", "Clipper", -4000, "C5"),          // under receipt threshold
    gl("L6", "2026-08-02", "Office Depot", -9900, "C3"),      // next month: not in July package
    gl("L7", "2026-07-10", "Comcast", -12999, null),          // general funds: not selected
  ];
  return { grant: CITY, periodStart: "2026-07-01", periodEnd: "2026-07-31", lines, decisions: lines.map(auto),
    receipts: [{ receiptId: "R1", matchedTxnId: "L4" }, { receiptId: "R2", matchedTxnId: "L6" }], resolutions: [], priorPackages: [] };
}
const get = (p: ReturnType<typeof buildPackage>, id: string) => p.checks.find((c) => c.id === id)!;

check("baseline package: all seven checks pass, totals exact", () => {
  const p = buildPackage(base());
  assert.deepEqual(p.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`), []);
  assert.equal(p.invoiceTotalCents, 100005 + 23450 + 12346 + 8000 + 4000);
  assert.equal(p.glTotalCents, p.invoiceTotalCents);
  assert.equal(p.totalsByBudgetLine.C1, 123455);
  assert.equal(p.lines.length, 5);
  assert.equal(p.allPass, true);
});

check("sum off by one cent fails SUM_TIES", () => {
  const i = base();
  i.decisions = i.decisions.map((d) => d.txnId === "L4"
    ? { ...d, grantId: null, budgetLine: null, splits: [{ grantId: "FS-27-0412", budgetLine: "C3", amount: -4000 }, { grantId: null, budgetLine: null, amount: -3999 }] } : d);
  const c = get(buildPackage(i), "SUM_TIES");
  assert.equal(c.pass, false);
  assert.match(c.detail, /off by|don't add up/);
  assert.equal(c.numbers.splitErrors, 1);
});

check("indirect: 10% of $1,234.55 = $123.455 → $123.46 (half cent rounds up); $123.45 fails", () => {
  assert.equal(applyRate(123455, 1000), 12346);
  assert.equal(applyRate(5, 1000), 1);
  assert.equal(applyRate(4, 1000), 0);
  const ok = get(buildPackage(base()), "INDIRECT_ROUNDING");
  assert.equal(ok.pass, true, ok.detail);
  assert.equal(ok.numbers.computedCents, 12346);
  const i = base();
  i.lines = i.lines.map((t) => t.txnId === "L3" ? { ...t, amountCents: -12345 } : t);
  const bad = get(buildPackage(i), "INDIRECT_ROUNDING");
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /off by -\$0\.01/);
});

check("indirect base excludes moved-off salary (recomputed on what is billed)", () => {
  const i = base();
  i.decisions = i.decisions.map((d) => d.txnId === "L2" ? { ...d, status: "needs_review" as const, grantId: null, budgetLine: null } : d);
  i.resolutions = [{ txnId: "L2", resolution: "acknowledged", by: "A. Okafor (Executive Director)" }];
  const p = buildPackage(i);
  assert.equal(p.indirect.baseCents, 100005);
  assert.equal(get(p, "INDIRECT_ROUNDING").pass, false, "JE still claims 10% of the old base");
  assert.equal(p.excluded[0]!.txnId, "L2");
});

check("cumulative over budget (prior signed package + this) fails; drafts are ignored", () => {
  const i = base();
  i.priorPackages = [{ periodStart: "2026-06-01", periodEnd: "2026-06-30", status: "signed", totalsByBudgetLine: { C3: 522_001 } }];
  const c = get(buildPackage(i), "CUMULATIVE_WITHIN_BUDGET");
  assert.equal(c.pass, false, "5,220.01 + 80.00 > 4,800 × 110% = 5,280.00");
  assert.match(c.detail, /C3 cumulative \$5,300\.01 > cap \$5,280\.00/);
  i.priorPackages = [{ ...i.priorPackages[0]!, totalsByBudgetLine: { C3: 520_000 } }];
  assert.equal(get(buildPackage(i), "CUMULATIVE_WITHIN_BUDGET").pass, true, "exactly at the cap is allowed");
  i.priorPackages = [{ ...i.priorPackages[0]!, status: "draft", totalsByBudgetLine: { C3: 999_999 } }];
  assert.equal(get(buildPackage(i), "CUMULATIVE_WITHIN_BUDGET").pass, true);
});

check("out of period: a June charge before the contract start fails IN_PERIOD", () => {
  const i = base();
  i.periodStart = "2026-06-01";
  i.lines = [...i.lines, gl("L8", "2026-06-28", "Costco", -21137, "C4")];
  i.decisions = [...i.decisions, auto(i.lines.at(-1)!)];
  i.receipts = [...i.receipts, { receiptId: "R3", matchedTxnId: "L8" }];
  const c = get(buildPackage(i), "IN_PERIOD");
  assert.equal(c.pass, false);
  assert.match(c.detail, /L8 2026-06-28/);
});

check("open exception fails; human-resolved exception passes (and counts as program approval)", () => {
  const i = base();
  i.lines = i.lines.map((t) => t.txnId === "L4" ? { ...t, programApprovedBy: null } : t);
  i.decisions = i.decisions.map((d) => d.txnId === "L4" ? { ...d, status: "needs_review" as const, ruleHits: ["R-PURPOSE-UNCLEAR"] } : d);
  let p = buildPackage(i);
  assert.equal(get(p, "NO_OPEN_EXCEPTIONS").pass, false);
  assert.equal(get(p, "PROGRAM_APPROVAL").pass, false);
  i.resolutions = [{ txnId: "L4", resolution: "acknowledged", by: "A. Okafor (Executive Director)" }];
  p = buildPackage(i);
  assert.equal(get(p, "NO_OPEN_EXCEPTIONS").pass, true);
  assert.equal(get(p, "PROGRAM_APPROVAL").pass, true);
  assert.equal(p.allPass, true);
});

check("unallowable line is excluded and listed with its reason, never silently dropped", () => {
  const i = base();
  const dinner = gl("L9", "2026-07-21", "Casa Lumbre Cocina", -18675, "C3", { memo: "Staff appreciation dinner" });
  i.lines = [...i.lines, dinner];
  i.receipts = [...i.receipts, { receiptId: "R9", matchedTxnId: "L9" }];
  i.decisions = [...i.decisions, { txnId: "L9", grantId: null, budgetLine: null, status: "blocked", ruleHits: ["R-UNALLOWABLE-STAFF_EVENT"],
    checks: [{ label: "Staff event or meal", message: "Staff appreciation dinner is not allowed (FS-27-0412 §6.2)." }] }];
  i.resolutions = [{ txnId: "L9", resolution: "acknowledged", by: "A. Okafor (Executive Director)" }];
  const p = buildPackage(i);
  assert.equal(p.lines.some((l) => l.txnId === "L9"), false);
  assert.deepEqual(p.excluded.map((x) => [x.txnId, x.amountCents, x.claimedBudgetLine]), [["L9", 18675, "C3"]]);
  assert.match(p.excluded[0]!.reason, /§6\.2/);
  assert.equal(p.glTotalCents - p.invoiceTotalCents, 18675);
  assert.equal(get(p, "SUM_TIES").pass, true, get(p, "SUM_TIES").detail);
  // overridden by a human → bookkeeper's coding stands → billed
  i.resolutions = [{ txnId: "L9", resolution: "overridden", by: "A. Okafor (Executive Director)" }];
  assert.equal(buildPackage(i).lines.some((l) => l.txnId === "L9"), true);
});

check("receipts: non-payroll charge ≥ $75 without a matched receipt fails", () => {
  const i = base();
  i.receipts = [];
  const c = get(buildPackage(i), "RECEIPTS");
  assert.equal(c.pass, false);
  assert.match(c.detail, /L4/);
  assert.doesNotMatch(c.detail, /L1|L3|L5/, "payroll, JE and under-threshold are exempt");
});

check("CSV export ties to the snapshot; a tampered snapshot is refused", () => {
  const p = buildPackage(base());
  const meta = { organization: "SYNTHETIC Org", invoiceNo: "FS-27-0412-2026-07", funder: CITY.funder, program: CITY.program, preparedBy: "J. Rivera (Staff Accountant)", reviewedBy: "A. Okafor (Executive Director)", signedAt: "2026-08-05" };
  const csv = packageCsv(p, meta);
  assert.match(csv, /Invoice total,1478\.01/);
  assert.match(csv, /Line detail total,1478\.01/);
  assert.throws(() => packageCsv({ ...p, invoiceTotalCents: p.invoiceTotalCents + 1 }, meta), /does not tie/);
  const evil = buildPackage({ ...base(), lines: base().lines.map((t) => t.txnId === "L4" ? { ...t, vendor: "=HYPERLINK(\"x\")" } : t) });
  assert.match(packageCsv(evil, meta), /"'=HYPERLINK\(""x""\)"/);
});

check("billing periods: monthly for the city contract, quarterly for the foundation", () => {
  const m = billingPeriods(CITY, "2026-10-15");
  assert.deepEqual(m.map((x) => `${x.periodStart}..${x.periodEnd}`), ["2026-07-01..2026-07-31", "2026-08-01..2026-08-31", "2026-09-01..2026-09-30", "2026-10-01..2026-10-31"]);
  const q = billingPeriods(FIXTURE_GRANTS_V2[1]!, "2026-10-15");
  assert.deepEqual(q.map((x) => `${x.periodStart}..${x.periodEnd}`), ["2026-06-01..2026-08-31", "2026-09-01..2026-11-30"]);
  assert.deepEqual(billingPeriods({ ...CITY, billing: null }, "2026-10-15"), [{ periodStart: CITY.periodStart, periodEnd: CITY.periodEnd }]);
});

check("v2 GL July package builds and ties (bookkeeper coding, no review yet)", () => {
  const { lines } = parseGlDetail(readFileSync("steward-data-v2/gl_detail_qb.csv", "utf8"));
  const p = buildPackage({ grant: CITY, periodStart: "2026-07-01", periodEnd: "2026-07-31", lines, decisions: lines.map(auto), receipts: [], resolutions: [], priorPackages: [] });
  assert.equal(get(p, "SUM_TIES").pass, true);
  assert.ok(p.invoiceTotalCents > 0);
  console.log(`     July invoice ${p.invoiceTotalCents} cents; indirect ${p.indirect.computedCents} computed vs ${p.indirect.claimedCents} claimed; failing: ${p.checks.filter((c) => !c.pass).map((c) => c.id).join(", ")}`);
});

if (failures) { console.log(`\n${failures} tie-out check(s) failed`); process.exit(1); }
console.log("\nAll tie-out checks passed");
