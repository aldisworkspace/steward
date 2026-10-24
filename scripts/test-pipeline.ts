/**
 * Offline end-to-end check of lib/pipeline.ts with a FAKE model (no API calls).
 * The fake coder is deliberately naive: it copies the bookkeeper's GL coding (mistakes included)
 * and guesses from vendor names otherwise. This tests that the verification layer catches the
 * planted problems even when the model is mediocre. Real-model quality is measured separately.
 */
import { readFileSync } from "node:fs";
import type { ModelClient } from "../lib/llm";
import { parseBank, parseGl, parseStaff } from "../lib/parse";
import { runPipeline } from "../lib/pipeline";
import type { Precedent } from "../lib/types";
import { FIXTURE_GRANTS } from "./fixtures";

const D = process.argv[2] ?? "../steward-data";
const input = {
  txns: parseBank(readFileSync(`${D}/bank_transactions_q3_2026.csv`, "utf8")),
  gl: parseGl(readFileSync(`${D}/gl_export_bookkeeper.csv`, "utf8")),
  staff: parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8")),
  precedents: (JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")) as Omit<Precedent, "id">[]).map((p, i) => ({ id: `P${i + 1}`, ...p })),
  grants: FIXTURE_GRANTS,
};

const NAIVE: [RegExp, string | null, string | null][] = [
  [/DELL MARKETING/, "GA-2026-114", "A3"], [/SFMTA/, "GA-2026-114", "A5"], [/PALACE OF FINE ARTS/, "HLF-26-031", "B4"],
  [/BAY AREA DISCOVERY|ACADEMY OF SCI|EXPLORATORIUM|CHARTER BUS/, "HLF-26-031", "B3"],
  [/SCHOLASTIC|GREEN APPLE|DEMCO|LAKESHORE/, "HLF-26-031", "B2"],
  [/VENMO/, "GA-2026-114", "A4"], [/CLIPPER/, "GA-2026-114", "A5"],
  [/AMAZON|OFFICE DEPOT|STAPLES|COSTCO|TAQUERIA/, "GA-2026-114", "A3"],
];

const fake: ModelClient = {
  async json({ content }) {
    const text = (content.find((c) => c.type === "text") as { text: string }).text;
    const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]);
    const codings = rows.map((r: any) => {
      if (r.amountUsd > 0) return { txnId: r.txnId, grantId: r.gl?.class ?? null, budgetLine: r.gl?.budgetLine ?? null, confidence: 0.95, rationale: "Income / refund.", clauseRefs: [], concern: null };
      if (process.env.CAUTIOUS && !r.memo && r.amountUsd > -250) {
        const h = r.vendorHistory?.[0];
        if (process.env.CAUTIOUS === "history" && h) return { txnId: r.txnId, grantId: h.grantId, budgetLine: h.budgetLine, confidence: 0.8, rationale: "Follows vendor history; no memo.", clauseRefs: [], concern: null };
        return { txnId: r.txnId, grantId: null, budgetLine: null, confidence: 0.6, rationale: "No memo; unclear purpose.", clauseRefs: [], concern: null };
      }
      if (r.gl) return { txnId: r.txnId, grantId: r.gl.class, budgetLine: r.gl.budgetLine, confidence: 0.9, rationale: "Matches bookkeeper coding.", clauseRefs: [], concern: null };
      const n = NAIVE.find(([re]) => re.test(r.description));
      return { txnId: r.txnId, grantId: n?.[1] ?? null, budgetLine: n?.[2] ?? null, confidence: n ? 0.8 : 0.9, rationale: n ? "Vendor pattern." : "General operations.", clauseRefs: [], concern: null };
    });
    return { data: { codings } as any, usage: { input: 0, output: 0 } };
  },
};

async function main() {
  const res = await runPipeline(fake, input);

  const exp = JSON.parse(readFileSync(`${D}/expected_labels.json`, "utf8"));
  const expGl = JSON.parse(readFileSync(`${D}/expected_gl_findings.json`, "utf8"));
  const issues = new Set<string>([...exp.filter((e: any) => e.issue).map((e: any) => e.id), ...expGl.map((e: any) => e.id)]);
  const flagged = new Set(res.decisions.filter((d) => d.status !== "auto").map((d) => d.txnId));
  const tp = [...flagged].filter((id) => issues.has(id)).length;

  let ok = 0, n = 0; const wrong: string[] = [];
  for (const e of exp) {
    if (issues.has(e.id)) continue;
    const d = res.decisions.find((x) => x.txnId === e.id)!;
    n++;
    const want = e.grant === "UNRESTRICTED" || e.grant === "INCOME" ? null : e.grant;
    const good = e.grant === "SPLIT" ? !!d.splits : (d.grantId ?? null) === want && (want === null || d.budgetLine === e.line);
    if (good) ok++; else wrong.push(`${e.id} ${e.description} want ${want}:${e.line} got ${d.grantId}:${d.budgetLine}`);
  }

  console.log(`errors: ${res.errors.length}`);
  console.log(`Issue recall ${tp}/${issues.size}, precision ${tp}/${flagged.size}`);
  console.log(`False positives: ${[...flagged].filter((id) => !issues.has(id)).join(", ") || "none"}`);
  console.log(`Coding accuracy on clean rows: ${ok}/${n}`);
  if (wrong.length) console.log("  " + wrong.slice(0, 10).join("\n  "));
  console.log(`\nProposed journal entries: ${res.entries.length} (all balanced)`);
  for (const e of res.entries.slice(0, 4)) {
    console.log(`  ${e.memo}`);
    for (const l of e.lines) console.log(`     ${l.debitCents ? "Dr" : "  Cr"} ${l.account} [${l.class ?? "unrestricted"}${l.budgetLine ? ":" + l.budgetLine : ""}] ${((l.debitCents || l.creditCents) / 100).toFixed(2)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
