/**
 * Real-model evaluation on any dataset directory, without Convex.
 *   ANTHROPIC_API_KEY=... npx tsx scripts/eval-offline.ts steward-holdout
 * Extracts every *.pdf in the folder with Claude, runs the full pipeline, scores against the
 * folder's expected_*.json, and writes <dir>/eval-result.json. The pipeline never sees the answer key.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { anthropicClient } from "../lib/llm";
import { parseBank, parseGl, parseStaff } from "../lib/parse";
import { extractGrantTerms, runPipeline } from "../lib/pipeline";
import type { Precedent } from "../lib/types";

async function main() {
  const D = process.argv[2];
  if (!D) throw new Error("usage: eval-offline.ts <dataset-dir>");
  const model = anthropicClient();
  const t0 = Date.now();

  const pdfs = readdirSync(D).filter((f) => f.endsWith(".pdf"));
  const grants = [];
  for (const f of pdfs) {
    const g = await extractGrantTerms(model, readFileSync(`${D}/${f}`).toString("base64"));
    console.log(`extracted ${f}: ${g.grantId}, ${g.budgetLines.length} lines, ${g.unallowable.length} unallowables, ${g.priorApproval.length} prior-approval rules`);
    grants.push(g);
  }
  const input = {
    txns: parseBank(readFileSync(`${D}/bank_transactions_q3_2026.csv`, "utf8")),
    gl: parseGl(readFileSync(`${D}/gl_export_bookkeeper.csv`, "utf8")),
    staff: parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8")),
    precedents: (JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")) as Omit<Precedent, "id">[]).map((p, i) => ({ id: `P${i + 1}`, ...p })),
    grants,
  };
  const res = await runPipeline(model, input);

  // ---- scoring (answer key read only here) ----
  const exp = JSON.parse(readFileSync(`${D}/expected_labels.json`, "utf8"));
  const expGl = JSON.parse(readFileSync(`${D}/expected_gl_findings.json`, "utf8"));
  const issues = new Set<string>([...exp.filter((e: any) => e.issue).map((e: any) => e.id), ...expGl.map((e: any) => e.id)]);
  const flagged = new Set(res.decisions.filter((d) => d.status !== "auto").map((d) => d.txnId));
  const tp = [...flagged].filter((id) => issues.has(id)).length;
  const fps = [...flagged].filter((id) => !issues.has(id));
  const misses = [...issues].filter((id) => !flagged.has(id));
  let ok = 0, n = 0; const wrong: string[] = [];
  for (const e of exp) {
    if (issues.has(e.id)) continue;
    const d = res.decisions.find((x) => x.txnId === e.id)!; n++;
    const want = e.grant === "UNRESTRICTED" || e.grant === "INCOME" ? null : e.grant;
    const good = e.grant === "SPLIT" ? !!d.splits : (d.grantId ?? null) === want && (want === null || d.budgetLine === e.line);
    if (good) ok++; else wrong.push(`${e.id} ${e.description} want ${want}:${e.line} got ${d.grantId}:${d.budgetLine}`);
  }
  const show = (id: string) => {
    const d = res.decisions.find((x) => x.txnId === id)!; const e = exp.find((x: any) => x.id === id);
    return `${id} ${e.description} ${e.amount} | ${d.status} ${d.grantId}:${d.budgetLine} | rules: ${d.ruleHits.join(",") || "-"} | ${d.rationale.slice(0, 220)}`;
  };
  const summary = {
    dataset: D, issues: issues.size, recall: `${tp}/${issues.size}`, precision: `${tp}/${flagged.size}`,
    cleanRowAccuracy: `${ok}/${n}`, tokens: res.usage, seconds: Math.round((Date.now() - t0) / 1000), errors: res.errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nMISSED ISSUES:\n  " + (misses.map(show).join("\n  ") || "none"));
  console.log("\nFALSE POSITIVES:\n  " + (fps.map(show).join("\n  ") || "none"));
  console.log("\nCODING MISSES:\n  " + (wrong.join("\n  ") || "none"));
  writeFileSync(`${D}/eval-result.json`, JSON.stringify({ ...summary, misses, falsePositives: fps, codingMisses: wrong }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
