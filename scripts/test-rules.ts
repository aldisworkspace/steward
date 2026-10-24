/**
 * Rules-only check (zero model calls).
 * Candidates = the bookkeeper's GL coding where it exists. For September/October rows that the
 * GL doesn't cover, we use a hand-written "naive proposal" fixture: what a coder would plausibly
 * guess from the memo before verification. In the app, these come from the model (T4).
 * Grant terms here are hand-transcribed fixtures; in the app they come from extract.grantTerms (T2).
 */
import { readFileSync } from "node:fs";
import { parseBank, parseGl, parseStaff } from "../lib/parse";
import { runRules } from "../lib/rules";
import type { Candidate, Precedent } from "../lib/types";
import { FIXTURE_GRANTS } from "./fixtures";

const D = process.argv[2] ?? "steward-data";
const txns = parseBank(readFileSync(`${D}/bank_transactions_q3_2026.csv`, "utf8"));
const gl = parseGl(readFileSync(`${D}/gl_export_bookkeeper.csv`, "utf8"));
const staff = parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8"));
const precedents: Precedent[] = JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")).map((p: any, i: number) => ({ id: `P${i + 1}`, ...p }));

const grants = FIXTURE_GRANTS;

// Naive proposals for rows the GL doesn't cover (by description prefix).
const NAIVE: [RegExp, string | null, string | null][] = [
  [/DELL MARKETING/, "GA-2026-114", "A3"],
  [/SFMTA CITATION/, "GA-2026-114", "A5"],
  [/PALACE OF FINE ARTS/, "HLF-26-031", "B4"],
  [/BAY AREA DISCOVERY/, "HLF-26-031", "B3"],
  [/VENMO|CLIPPER|LA TAQUERIA|AMAZON|OFFICE DEPOT|STAPLES|COSTCO/, "GA-2026-114", null],
];
const glByRef = new Map(gl.map((r) => [r.bankRef, r]));
const candidates = new Map<string, Candidate>();
for (const t of txns) {
  const r = glByRef.get(t.txnId);
  if (r) { candidates.set(t.txnId, { txnId: t.txnId, grantId: r.class, budgetLine: r.budgetLine, origin: "gl" }); continue; }
  const n = NAIVE.find(([re]) => re.test(t.description));
  candidates.set(t.txnId, { txnId: t.txnId, grantId: n?.[1] ?? null, budgetLine: n?.[2] ?? null, origin: n ? "model" : "none" });
}

const findings = runRules({ txns, gl, staff, grants, precedents, candidates });

// Compare against answer key
const expBank = JSON.parse(readFileSync(`${D}/expected_labels.json`, "utf8")).filter((e: any) => e.issue);
const expGl = JSON.parse(readFileSync(`${D}/expected_gl_findings.json`, "utf8"));
const expected = new Set<string>([...expBank.map((e: any) => e.id), ...expGl.map((e: any) => e.id)]);
const flagged = new Set(findings.map((f) => f.txnId));

console.log(`\n${findings.length} findings on ${flagged.size} transactions\n`);
for (const f of findings) {
  const t = txns.find((x) => x.txnId === f.txnId);
  console.log(`${expected.has(f.txnId) ? "✓" : "✗ FP"} ${f.txnId} [${f.ruleId}] ${f.status}  ${t?.description.slice(0, 28)}\n     ${f.message}`);
}
const missed = [...expected].filter((id) => !flagged.has(id));
const tp = [...flagged].filter((id) => expected.has(id)).length;
const fp = [...flagged].filter((id) => !expected.has(id)).length;
console.log(`\nRecall ${tp}/${expected.size}  Precision ${tp}/${flagged.size}`);
console.log(`Missed (left for the model): ${missed.map((id) => `${id} ${txns.find((t) => t.txnId === id)?.description}`).join(", ") || "none"}`);
if (fp > 1) process.exit(1);
