/**
 * GL-first coding context, offline (fake model, no API calls), on the SYNTHETIC v2 GL detail.
 * Checks what the model is shown and how payroll / evidence / guards behave — not answer-key accuracy
 * (that is scripts/eval*, which may read expected_v2.json; this script must not).
 *   npx tsx scripts/test-gl-pipeline.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ModelClient } from "../lib/llm";
import { parseStaff } from "../lib/parse";
import { parseGlDetail } from "../lib/parseGlDetail";
import { runPipeline } from "../lib/pipeline";
import type { Precedent } from "../lib/types";
import { FIXTURE_GRANTS_V2 } from "./fixturesV2";

const D = "steward-data-v2";
let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}

async function main() {
  const parsed = parseGlDetail(readFileSync(`${D}/gl_detail_qb.csv`, "utf8"));
  const staff = parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8"));
  const precedents: Precedent[] = (JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")) as Omit<Precedent, "id">[]).map((p, i) => ({ id: `P${i + 1}`, ...p }));

  await check("v2 GL parses: 164 lines, QuickBooks format, negative-outflow convention", () => {
    assert.equal(parsed.error, null);
    assert.equal(parsed.format, "quickbooks");
    assert.equal(parsed.lines.length + parsed.skipped.length, 164);
    assert.equal(parsed.skipped.length, 0, JSON.stringify(parsed.skipped.slice(0, 3)));
    const credit = parsed.lines.find((l) => l.txnType === "Credit Card Credit")!;
    assert.ok(credit.amountCents > 0, "refund is money back");
    assert.ok(parsed.lines.filter((l) => l.txnType === "Paycheck").every((l) => l.amountCents < 0));
    assert.ok(parsed.lines.some((l) => l.glClass === "FS-27-0412" && l.glBudgetLine === "C7"), "indirect JE coded to C7");
  });

  const batches: { txnId: string; gl: Record<string, unknown> | null; vendorHistory: { amountUsd?: number; grantId?: string | null }[]; receipt?: unknown }[][] = [];
  const fake: ModelClient = {
    async json({ content }) {
      const text = (content.find((c) => c.type === "text") as { text: string }).text;
      const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]!);
      batches.push(rows);
      const codings = rows.map((r: { txnId: string; gl: { class: string | null; budgetLine: string | null } | null }, i: number) => ({
        txnId: r.txnId,
        // one hallucinated grant and a made-up clause, to exercise the guards
        grantId: i === 0 && batches.length === 1 ? "NOPE-1" : (r.gl?.class ?? null),
        budgetLine: r.gl?.budgetLine ?? null, confidence: 0.9, rationale: "Follows the bookkeeper's claim.",
        clauseRefs: i === 1 ? ["FS-27-0412 §99.9"] : [], concern: null }));
      codings.push({ txnId: "L9999", grantId: null, budgetLine: null, confidence: 1, rationale: "ghost", clauseRefs: [], concern: null });
      return { data: { codings } as never, usage: { input: 0, output: 0 } };
    },
  };
  const res = await runPipeline(fake, { txns: parsed.lines, gl: parsed.glRows, staff, grants: FIXTURE_GRANTS_V2, precedents });
  const rows = batches.flat();
  const d = (id: string) => res.decisions.find((x) => x.txnId === id)!;

  await check("payroll lines are coded from time records, not sent to the model", () => {
    const pay = parsed.lines.filter((l) => l.txnType === "Paycheck");
    assert.ok(pay.length > 50);
    assert.equal(rows.filter((r) => pay.some((p) => p.txnId === r.txnId)).length, 0);
    const barton = pay.find((l) => l.vendor === "David Barton" && l.glClass === "FS-27-0412")!;
    assert.equal(d(barton.txnId).grantId, "FS-27-0412");
    assert.equal(d(barton.txnId).confidence, 1);
    assert.match(d(barton.txnId).rationale, /allocation/);
  });
  await check("model sees the bookkeeper's claim with GL dimensions and amount-aware vendor history", () => {
    const r = rows.find((x) => x.gl && (x.gl as { docRef?: string }).docRef);
    assert.ok(r, "docRef in gl claim");
    assert.ok(rows.every((x) => x.gl && "account" in x.gl && "department" in x.gl));
    const withHist = rows.find((x) => x.vendorHistory.length);
    assert.ok(withHist && typeof withHist.vendorHistory[0]!.amountUsd === "number" && "grantId" in withHist.vendorHistory[0]!);
  });
  await check("evidence starts with the GL line; guards hold (unknown grant, fake clause, ghost id)", () => {
    const first = rows[0]!.txnId;
    assert.equal(d(first).evidence[0]!.source, "gl");
    assert.equal(d(first).grantId === "NOPE-1", false, "unknown grant never kept");
    assert.ok(d(first).status !== "auto");
    assert.ok(!d(rows[1]!.txnId).evidence.some((e) => e.ref === "FS-27-0412 §99.9"), "unverified clause dropped");
    assert.equal(res.decisions.some((x) => x.txnId === "L9999"), false);
    assert.equal(res.decisions.length, parsed.lines.length);
  });
  await check("journal entries balance; no errors", () => {
    assert.equal(res.errors.length, 0);
    for (const e of res.entries) {
      const dr = e.lines.reduce((a, l) => a + l.debitCents, 0), cr = e.lines.reduce((a, l) => a + l.creditCents, 0);
      assert.equal(dr, cr);
    }
  });

  await check("progress callback is awaited (no outstanding mutation when the run returns)", async () => {
    let inFlight = 0, calls = 0;
    const few = parsed.lines.filter((l) => l.txnType !== "Paycheck").slice(0, 30);
    await runPipeline(fake, { txns: few, gl: parsed.glRows.filter((g) => few.some((l) => l.txnId === g.bankRef)), staff, grants: FIXTURE_GRANTS_V2, precedents },
      async () => { inFlight++; calls++; await new Promise((r) => setTimeout(r, 20)); inFlight--; });
    assert.ok(calls >= 2, `calls ${calls}`);
    assert.equal(inFlight, 0, "a progress write was still running when runPipeline resolved");
  });

  const counts = new Map<string, number>();
  for (const x of res.decisions) for (const h of x.ruleHits) counts.set(h, (counts.get(h) ?? 0) + 1);
  console.log(`\n${res.decisions.filter((x) => x.status !== "auto").length} open of ${res.decisions.length}; hits: ${[...counts].map(([k, v]) => `${k}×${v}`).join(", ")}`);
  if (failures) { console.log(`\n${failures} GL pipeline check(s) failed`); process.exit(1); }
  console.log("All GL-first pipeline checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
