/**
 * Status policy: "can't be billed as booked" = blocked, with a proposed correction for the blocked portion and a
 * way out; documentation gaps stay needs_review. SYNTHETIC inline fixtures, fake model, no API calls.
 *   npx tsx scripts/test-status-policy.ts
 */
import assert from "node:assert/strict";
import type { ModelClient } from "../lib/llm";
import { computeFundBreakdown } from "../lib/fundBreakdown";
import { issueLabel } from "../lib/issueLabel";
import { runPipeline } from "../lib/pipeline";
import { ALCOHOL_ITEM, runRules } from "../lib/rules";
import type { Candidate, GlRow, ReceiptRecord, Txn, TypedPrecedent } from "../lib/types";
import { fixTypeOf } from "../app/lib/fixType";
import { FIXTURE_GRANTS_V2 } from "./fixturesV2";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}
const CITY = FIXTURE_GRANTS_V2[0]!;
const gl = (id: string, date: string, vendor: string, cents: number, line: string | null, extra: Partial<Txn> = {}): Txn => ({
  txnId: id, date, description: vendor, vendor, amountCents: cents, memo: "", source: "gl", account: "6100 Supplies", docRef: "",
  txnType: "Expense", glClass: line ? CITY.grantId : null, glBudgetLine: line, enteredBy: "bookkeeper", department: "", ...extra,
});
const glRowsOf = (ls: Txn[]): GlRow[] => ls.map((l) => ({ bankRef: l.txnId, date: l.date, description: l.description, amountCents: l.amountCents,
  account: l.account!, class: l.glClass ?? null, budgetLine: l.glBudgetLine ?? null, enteredBy: "bk" }));
const claims = (ls: Txn[]) => new Map<string, Candidate>(ls.map((t) => [t.txnId, { txnId: t.txnId, grantId: t.glClass ?? null, budgetLine: t.glBudgetLine ?? null, origin: "gl" as const }]));
/** Fake model that agrees with the bookkeeper on every row. */
const agree: ModelClient = {
  async json({ content }) {
    const text = (content.find((c) => c.type === "text") as { text: string }).text;
    const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]!) as { txnId: string; gl: { class: string | null; budgetLine: string | null } | null }[];
    return { data: { codings: rows.map((r) => ({ txnId: r.txnId, grantId: r.gl?.class ?? null, budgetLine: r.gl?.budgetLine ?? null, confidence: 0.9,
      rationale: "Follows the bookkeeper.", clauseRefs: [], concern: null })) } as never, usage: { input: 0, output: 0 } };
  },
};

// A coaches' dinner on an allowable line whose receipt itemises 3 glasses of wine ($39.00 of a $212.01 subtotal).
const dinner = gl("L0201", "2026-09-19", "Harbor Conference Hotel", -26872, "C5", { memo: "Coaches clinic dinner", account: "5150 Training & Travel" });
const dinnerReceipt: ReceiptRecord = { receiptId: "RD", fileName: "hotel.pdf", matchedTxnId: "L0201", matchScore: 1, matchedBy: "auto", extracted: {
  vendor: "Harbor Conference Hotel", date: "2026-09-19", totalCents: 26872, purposeText: null,
  lineItems: [{ description: "House pinot noir (glass) 3 @ 13.00", amountCents: 3900 }, { description: "Grilled salmon", amountCents: 3100 },
    { description: "Chicken piccata", amountCents: 7304 }, { description: "Caesar salad", amountCents: 2898 }, { description: "Iced tea", amountCents: 2800 },
    { description: "Chocolate torte", amountCents: 1199 }] } };
const scoreboard = gl("L0202", "2026-10-07", "Corvane Athletic Equipment", -633950, "C4", { account: "5110 Equipment", docRef: "CAE-9993" });
// Participant support C4: budget $27,240 + 10% = $29,964 cap.
const c4 = [gl("L0203", "2026-09-02", "Charter Coaches", -2_800_000, "C4"), gl("L0204", "2026-10-03", "Charter Coaches", -300_000, "C4")];

async function main() {
  await check("alcohol on a receipt line item (not in the memo) → blocked; the alcohol share with its tax and tip moves off", () => {
    const fs = runRules({ txns: [dinner], gl: glRowsOf([dinner]), staff: [], grants: [CITY], precedents: [], candidates: claims([dinner]), receipts: [dinnerReceipt] });
    const f = fs.find((x) => x.ruleId === "R-UNALLOWABLE-ALCOHOL_STAFF")!;
    assert.ok(f, JSON.stringify(fs.map((x) => x.ruleId)));
    assert.equal(f.status, "blocked");
    // 3900 × 26872 / 21201 = 4943.2 → 4943
    assert.equal(f.exposureCents, 4943);
    assert.deepEqual(f.suggestion!.map((s) => [s.grantId, s.budgetLine, s.amountCents]), [[CITY.grantId, "C5", -26872 + 4943], [null, null, -4943]]);
    assert.ok(f.evidence.some((e) => e.source === "contract" && e.ref === "FS-27-0412 §6.1"));
    assert.ok(f.evidence.some((e) => e.source === "receipt" && e.ref === "RD"));
    assert.match(f.message, /\$49\.43 of it/);
  });
  await check("alcohol vocabulary does not catch ordinary receipt items", () => {
    for (const item of ["Granola bar 12ct", "Ginger ale 2L", "Root beer float", "Ginger beer 4pk", "Gingerbread", "Rumble pack"]) {
      assert.equal(ALCOHOL_ITEM.test(item), false, item);
    }
    for (const item of ["Pinot noir", "IPA pint", "Glass of wine", "Margarita pitcher"]) assert.ok(ALCOHOL_ITEM.test(item), item);
    const plain: ReceiptRecord = { ...dinnerReceipt, extracted: { ...dinnerReceipt.extracted!, lineItems: [{ description: "Granola bar", amountCents: 26872 }] } };
    assert.deepEqual(runRules({ txns: [dinner], gl: [], staff: [], grants: [CITY], precedents: [], candidates: claims([dinner]), receipts: [plain] })
      .filter((x) => x.ruleId.startsWith("R-UNALLOWABLE")), []);
  });
  await check("pipeline: the alcohol meal is blocked even when the model only asks (needs_review); at-risk = blocked share", async () => {
    const asks: ModelClient = { async json() { return { data: { codings: [{ txnId: "L0201", grantId: CITY.grantId, budgetLine: "C5", confidence: 0.6,
      rationale: "Clinic meal; receipt includes wine.", clauseRefs: [], concern: { status: "needs_review", reason: "Receipt includes a $39 glass of wine.", clauseRef: "FS-27-0412 §6.1" } }] } as never,
      usage: { input: 0, output: 0 } }; } };
    const res = await runPipeline(asks, { txns: [dinner], gl: glRowsOf([dinner]), staff: [], grants: [CITY], precedents: [], receipts: [dinnerReceipt] });
    const d = res.decisions[0]!;
    assert.equal(d.status, "blocked");
    assert.equal(d.ruleHits[0], "R-UNALLOWABLE-ALCOHOL_STAFF");
    assert.equal(d.atRiskCents, 4943);
    assert.deepEqual(d.splits!.map((s) => s.amount), [-21929, -4943]);
    assert.equal(issueLabel(d.ruleHits[0], d.status), "Alcohol — not allowed");
    assert.equal(fixTypeOf(d.ruleHits[0], d.status), "not_allowed");
    const e = res.entries.find((x) => x.txnId === "L0201")!;
    assert.deepEqual(e.lines.map((l) => [l.class, l.debitCents, l.creditCents]), [[null, 4943, 0], [CITY.grantId, 0, 4943]], "entry moves only the alcohol share");
  });

  await check("R-PRIOR-APPROVAL: over the threshold with no approval on file → blocked, move it all off; label and group", () => {
    const fs = runRules({ txns: [scoreboard], gl: glRowsOf([scoreboard]), staff: [], grants: [CITY], precedents: [], candidates: claims([scoreboard]) });
    const f = fs.find((x) => x.ruleId === "R-PRIOR-APPROVAL")!;
    assert.equal(f.status, "blocked");
    assert.deepEqual(f.suggestion, [{ grantId: null, budgetLine: null, amountCents: -633950 }]);
    assert.equal(f.exposureCents, 633950);
    assert.match(f.message, /Record the funder's written approval/);
    assert.equal(issueLabel("R-PRIOR-APPROVAL", "blocked"), "No funder approval — can't bill yet");
    assert.equal(fixTypeOf("R-PRIOR-APPROVAL", "blocked"), "approval", "grouped with approvals, not prohibitions");
  });
  await check("way out: the funder's approval (ruling scoped to the bookkeeper's grant) clears the block and keeps the coding", async () => {
    const before = await runPipeline(agree, { txns: [scoreboard], gl: glRowsOf([scoreboard]), staff: [], grants: [CITY], precedents: [] });
    assert.equal(before.decisions[0]!.status, "blocked");
    assert.equal(before.decisions[0]!.grantId, null, "proposed correction: off the grant until approved");
    const ruling: TypedPrecedent = { id: "P9", date: "2026-10-09", by: "A. Okafor", scope: CITY.grantId, match: { txnId: "L0202" }, ruling: "prior_approval_granted", note: "Funder approval on file: email Oct 8" };
    const after = await runPipeline(agree, { txns: [scoreboard], gl: glRowsOf([scoreboard]), staff: [], grants: [CITY], precedents: [], typedPrecedents: [ruling] });
    const d = after.decisions[0]!;
    assert.equal(d.status, "auto", JSON.stringify(d.ruleHits));
    assert.deepEqual([d.grantId, d.budgetLine], [CITY.grantId, "C4"]);
    assert.equal(after.entries.length, 0);
  });

  await check("R-LINE-OVERRUN: only the portion over budget + variance is blocked", () => {
    const fs = runRules({ txns: c4, gl: glRowsOf(c4), staff: [], grants: [CITY], precedents: [], candidates: claims(c4) });
    const f = fs.find((x) => x.ruleId === "R-LINE-OVERRUN")!;
    assert.equal(f.txnId, "L0204");
    assert.equal(f.status, "blocked");
    // 2,800,000 + 300,000 = 3,100,000 vs cap 2,996,400 → 103,600 over
    assert.equal(f.exposureCents, 103_600);
    assert.deepEqual(f.suggestion!.map((s) => [s.grantId, s.amountCents]), [[CITY.grantId, -300_000 + 103_600], [null, -103_600]]);
    assert.equal(issueLabel("R-LINE-OVERRUN", "blocked"), "Over budget line — can't bill the excess");
    assert.equal(fixTypeOf("R-LINE-OVERRUN", "blocked"), "approval");
  });
  await check("pipeline: overrun at-risk is the excess; a funder approval ruling clears it", async () => {
    const res = await runPipeline(agree, { txns: c4, gl: glRowsOf(c4), staff: [], grants: [CITY], precedents: [] });
    const d = res.decisions.find((x) => x.txnId === "L0204")!;
    assert.equal(d.status, "blocked");
    assert.equal(d.atRiskCents, 103_600);
    const ruling: TypedPrecedent = { id: "P9", date: "2026-10-09", by: "A. Okafor", scope: CITY.grantId, match: { txnId: "L0204" }, ruling: "prior_approval_granted", note: "Budget revision approved" };
    const ok = await runPipeline(agree, { txns: c4, gl: glRowsOf(c4), staff: [], grants: [CITY], precedents: [], typedPrecedents: [ruling] });
    assert.equal(ok.decisions.find((x) => x.txnId === "L0204")!.status, "auto");
  });

  await check("indirect: over the computed amount → blocked (amount fix); under → needs_review", () => {
    assert.equal(fixTypeOf("R-INDIRECT-RATE", "blocked"), "amount");
    assert.equal(fixTypeOf("R-INDIRECT-RATE", "needs_review"), "amount");
  });
  await check("documentation gaps stay needs_review", async () => {
    const supply = gl("L0205", "2026-10-14", "Harrow Hardware", -9211, "C3");
    const res = await runPipeline(agree, { txns: [supply], gl: glRowsOf([supply]), staff: [], grants: [CITY], precedents: [], receipts: [] });
    assert.equal(res.decisions[0]!.status, "needs_review");
    assert.equal(res.decisions[0]!.ruleHits[0], "R-RECEIPT-MISSING");
  });
  await check("fund breakdown: blocked approvals count as not billable; at-risk follows the blocked portion", () => {
    const b = computeFundBreakdown({
      transactions: [scoreboard, ...c4].map((t) => ({ txnId: t.txnId, amountCents: t.amountCents })),
      decisions: [{ txnId: "L0202", status: "blocked", grantId: null, ruleHits: ["R-PRIOR-APPROVAL"] },
        { txnId: "L0203", status: "auto", grantId: CITY.grantId, ruleHits: [] },
        { txnId: "L0204", status: "needs_review", grantId: CITY.grantId, ruleHits: ["R-NEEDS-DOCS"] }],
      entries: [], resolutionTxnIds: [], grants: [CITY],
    })!;
    assert.equal(b.totals.notAllowedCents, 633950);
    assert.equal(b.totals.needsYouCents, 300_000);
  });

  if (failures) { console.log(`\n${failures} status-policy check(s) failed`); process.exit(1); }
  console.log("\nAll status-policy checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
