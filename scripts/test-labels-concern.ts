/**
 * Offline regression checks for inbox labels, model-concern verification and case narrative.
 * Run: npx tsx scripts/test-labels-concern.ts   (exits 1 on failure)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bankSentence, caseNarrative, narrativeVendor } from "../lib/caseNarrative";
import { categorizeConcern, clauseRefEquals } from "../lib/categorizeConcern";
import { computeFundBreakdown } from "../lib/fundBreakdown";
import { inboxCategory } from "../lib/inboxFilters";
import { issueLabel } from "../lib/issueLabel";
import type { ModelClient } from "../lib/llm";
import { parseBank, parseGl, parseStaff } from "../lib/parse";
import { runPipeline } from "../lib/pipeline";
import type { Precedent, Txn } from "../lib/types";
import { FIXTURE_GRANTS } from "./fixtures";

let failures = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok   ${name}`))
    .catch((e: unknown) => {
      failures++;
      console.error(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
    });
}

const bus: Txn = {
  txnId: "T0034",
  date: "2026-08-03",
  description: "GOLDEN GATE CHARTER BUS",
  amountCents: -98000,
  memo: "Bus for Academy field trip",
};

async function main() {
  // --- shared label -------------------------------------------------------
  await check("blocked rows never read 'Needs your review'", () => {
    for (const ruleId of [null, undefined, "R-MODEL-REVIEW", "R-UNALLOWABLE-STAFF_EVENT", "R-UNALLOWABLE-OTHER", "R-SOMETHING-NEW"]) {
      assert.notEqual(issueLabel(ruleId, "blocked"), "Needs your review", String(ruleId));
    }
  });
  await check("staff event label", () => {
    assert.equal(issueLabel("R-UNALLOWABLE-STAFF_EVENT", "blocked"), "Staff event or meal — not allowed");
  });
  await check("needs_review rows never read 'not allowed'", () => {
    for (const ruleId of [null, "R-MODEL-REVIEW", "R-NEEDS-DOCS", "R-UNALLOWABLE-OTHER", "R-UNALLOWABLE-STAFF_EVENT"]) {
      assert.doesNotMatch(issueLabel(ruleId, "needs_review"), /not allowed/i, String(ruleId));
    }
    assert.equal(issueLabel("R-NEEDS-DOCS", "needs_review"), "Needs documentation");
    assert.equal(issueLabel(null, "needs_review"), "Needs your review");
  });
  await check("inbox category follows status", () => {
    assert.equal(inboxCategory("R-UNALLOWABLE-OTHER", "needs_review"), "other");
    assert.equal(inboxCategory("R-UNALLOWABLE-STAFF_EVENT", "blocked"), "not_allowed");
  });

  // --- clause matching ----------------------------------------------------
  await check("clauseRefEquals is exact (whitespace/§ normalized only)", () => {
    assert.ok(clauseRefEquals("GA-2026-114 §4.7", "GA-2026-114 §4.7"));
    assert.ok(clauseRefEquals("GA-2026-114  § 4.2", "GA-2026-114 §4.2; 2 CFR 200.423"));
    assert.ok(!clauseRefEquals("HLF-26-031", "HLF-26-031 §3.1"));
    assert.ok(!clauseRefEquals("GA-2026-114 §4", "GA-2026-114 §4.2"));
    assert.ok(!clauseRefEquals("HLF-26-031; §4.2", "HLF-26-031 §3.1"));
  });
  await check("exact clause of the charged grant blocks", () => {
    const cat = categorizeConcern(
      { status: "blocked", reason: "Staff appreciation dinner", clauseRef: "GA-2026-114 §4.7" },
      FIXTURE_GRANTS,
      { ...bus, txnId: "T0065", description: "THE BLACK CAT SF", amountCents: -48250 },
      ["GA-2026-114"],
    );
    assert.equal(cat.ruleId, "R-UNALLOWABLE-STAFF_EVENT");
    assert.equal(cat.status, "blocked");
    assert.equal(cat.evidence[0]?.ref, "GA-2026-114 §4.7");
  });
  await check("a clause from another grant must not block", () => {
    const cat = categorizeConcern(
      { status: "blocked", reason: "Could be entertainment", clauseRef: "GA-2026-114 §4.3" },
      FIXTURE_GRANTS,
      bus,
      ["HLF-26-031"],
    );
    assert.equal(cat.status, "needs_review");
    assert.ok(!cat.ruleId.startsWith("R-UNALLOWABLE"), cat.ruleId);
    assert.equal(cat.evidence.length, 0);
  });
  await check("purpose question with a loose clause cite is 'Needs documentation'", () => {
    const cat = categorizeConcern(
      { status: "needs_review", reason: "Confirm the trip purpose is the literacy program", clauseRef: "HLF-26-031" },
      FIXTURE_GRANTS,
      bus,
      ["HLF-26-031"],
    );
    assert.equal(cat.ruleId, "R-NEEDS-DOCS");
    assert.equal(cat.status, "needs_review");
    assert.equal(issueLabel(cat.ruleId, cat.status), "Needs documentation");
  });
  await check("prior-approval clause is never a block", () => {
    const cat = categorizeConcern(
      { status: "blocked", reason: "Equipment over threshold", clauseRef: "GA-2026-114 §5.1" },
      FIXTURE_GRANTS,
      bus,
      ["GA-2026-114"],
    );
    assert.equal(cat.ruleId, "R-PRIOR-APPROVAL");
    assert.equal(cat.status, "needs_review");
  });

  // --- narrative ----------------------------------------------------------
  await check("bank sentence is plain English from structured fields", () => {
    assert.equal(
      bankSentence({ date: "2026-08-21", description: "THE BLACK CAT SF", amountCents: -48250, memo: "Staff appreciation night - YPE team" }),
      'The Black Cat SF charged $482.50 on Aug 21, 2026 for "Staff appreciation night - YPE team".',
    );
    assert.equal(narrativeVendor("Golden Gate Charter Bus"), "Golden Gate Charter Bus");
    assert.ok(narrativeVendor("CALIFORNIA ACADEMY OF SCIENCES GROUP SALES DEPT 0042").length <= 32);
    const n = caseNarrative({
      txn: { date: "2026-08-21", description: "THE BLACK CAT SF", amountCents: -48250, memo: "" },
      hasGl: true,
      bkLabel: "Youth Pathways to Employment · Supplies",
      stewardLabel: "General funds",
      status: "blocked",
      actionHint: "",
    });
    assert.equal(n.happened, "The Black Cat SF charged $482.50 on Aug 21, 2026. Bookkeeper coded it as Youth Pathways to Employment · Supplies.");
    assert.doesNotMatch(n.happened, /2026-08-21|482\.50 —/);
  });

  // --- end to end: T0034 false "not allowed" --------------------------------
  await check("T0034 purpose question stays needs_review and out of not-allowed $", async () => {
    const D = "steward-data";
    const txns = parseBank(readFileSync(`${D}/bank_transactions_q3_2026.csv`, "utf8"));
    const gl = parseGl(readFileSync(`${D}/gl_export_bookkeeper.csv`, "utf8"));
    const glByRef = new Map(gl.map((g) => [g.bankRef, g]));
    const model: ModelClient = {
      async json({ content }) {
        const text = (content.find((c) => c.type === "text") as { text: string }).text;
        const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]) as { txnId: string }[];
        const codings = rows.map((r) => {
          const g = glByRef.get(r.txnId);
          const base = { txnId: r.txnId, grantId: g?.class ?? null, budgetLine: g?.budgetLine ?? null, confidence: 0.9, rationale: "Matches bookkeeper.", clauseRefs: [] as string[], concern: null as unknown };
          if (r.txnId === "T0034") {
            base.concern = { status: "blocked", reason: "Confirm the bus was for the literacy program field trip.", clauseRef: "HLF-26-031" };
          }
          return base;
        });
        return { data: { codings } as never, usage: { input: 0, output: 0 } };
      },
    };
    const res = await runPipeline(model, {
      txns,
      gl,
      staff: parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8")),
      precedents: (JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")) as Omit<Precedent, "id">[]).map((p, i) => ({ id: `P${i + 1}`, ...p })),
      grants: FIXTURE_GRANTS,
    });
    const d = res.decisions.find((x) => x.txnId === "T0034")!;
    assert.equal(d.status, "needs_review");
    assert.equal(d.ruleHits[0], "R-NEEDS-DOCS");
    assert.ok(!d.evidence.some((e) => e.source === "contract" && e.ref === "HLF-26-031"), "unverified clause cited as evidence");
    const glEv = d.evidence.find((e) => e.source === "gl");
    assert.equal(glEv?.note, "Bookkeeper coded it to Summer Literacy Lab · Field trips");
    const breakdown = computeFundBreakdown({
      transactions: txns.map((t) => ({ txnId: t.txnId, amountCents: t.amountCents })),
      decisions: res.decisions.map((x) => ({ txnId: x.txnId, status: x.status, grantId: x.grantId, ruleHits: x.ruleHits })),
      entries: [],
      resolutionTxnIds: [],
      grants: FIXTURE_GRANTS,
    })!;
    const hlf = breakdown.funds.find((f) => f.grantId === "HLF-26-031")!;
    const blockedHlf = res.decisions
      .filter((x) => x.grantId === "HLF-26-031" && x.status === "blocked")
      .reduce((a, x) => a + Math.abs(txns.find((t) => t.txnId === x.txnId)!.amountCents), 0);
    assert.equal(hlf.notAllowedCents, blockedHlf, "not-allowed $ must equal blocked decisions only");
    const blackCat = res.decisions.find((x) => x.txnId === "T0065")!;
    assert.equal(blackCat.status, "blocked");
    assert.equal(issueLabel(blackCat.ruleHits[0], blackCat.status), "Staff event or meal — not allowed");
  });

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll label/concern/narrative checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
