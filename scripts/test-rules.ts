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
import type { Candidate, GrantTerms, Precedent } from "../lib/types";

const D = process.argv[2] ?? "../steward-data";
const txns = parseBank(readFileSync(`${D}/bank_transactions_q3_2026.csv`, "utf8"));
const gl = parseGl(readFileSync(`${D}/gl_export_bookkeeper.csv`, "utf8"));
const staff = parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8"));
const precedents: Precedent[] = JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")).map((p: any, i: number) => ({ id: `P${i + 1}`, ...p }));

const grants: GrantTerms[] = [
  { grantId: "GA-2026-114", funder: "GGRWA", program: "Youth Pathways to Employment",
    periodStart: "2026-07-01", periodEnd: "2027-06-30", totalAward: 180000,
    budgetLines: [["A1", "Personnel", 110000], ["A2", "Fringe", 22000], ["A3", "Program supplies", 18000],
      ["A4", "Participant stipends", 20000], ["A5", "Local travel", 4000], ["A6", "Indirect", 6000]].map(([code, name, amount]) => ({ code: code as string, name: name as string, amount: amount as number })),
    lineVarianceLimitPct: null,
    unallowable: [
      { rule: "Alcoholic beverages", clauseRef: "GA-2026-114 §4.2; 2 CFR 200.423" },
      { rule: "Entertainment costs", clauseRef: "GA-2026-114 §4.3; 2 CFR 200.438" },
      { rule: "Fines, penalties, parking citations", clauseRef: "GA-2026-114 §4.4; 2 CFR 200.441" },
      { rule: "Fundraising costs incl. galas", clauseRef: "GA-2026-114 §4.5; 2 CFR 200.442" },
      { rule: "Lobbying", clauseRef: "GA-2026-114 §4.6; 2 CFR 200.450" },
      { rule: "Staff meals and staff appreciation events", clauseRef: "GA-2026-114 §4.7" },
    ],
    priorApproval: [{ rule: "Equipment item >= $5,000 per unit", thresholdUsd: 5000, clauseRef: "GA-2026-114 §5.1" }],
    indirectCapPct: 10, reportDue: "2026-10-30", restrictedPurpose: "Youth Pathways to Employment" },
  { grantId: "HLF-26-031", funder: "Harbor Light Foundation", program: "Summer Literacy Lab",
    periodStart: "2026-06-01", periodEnd: "2026-09-30", totalAward: 60000,
    budgetLines: [{ code: "B1", name: "Instructors", amount: 35000 }, { code: "B2", name: "Books and materials", amount: 15000 },
      { code: "B3", name: "Field trips", amount: 6000 }, { code: "B4", name: "Administration", amount: 4000 }],
    lineVarianceLimitPct: 15,
    unallowable: [{ rule: "Capital expenditures, endowment, debt service, political activity, fundraising events", clauseRef: "HLF-26-031 §3.1" }],
    priorApproval: [], indirectCapPct: null, reportDue: "2026-10-31", restrictedPurpose: "Summer Literacy Lab" },
];

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
console.log(`\nRecall ${tp}/${expected.size}  Precision ${tp}/${flagged.size}`);
console.log(`Missed (left for the model): ${missed.map((id) => `${id} ${txns.find((t) => t.txnId === id)?.description}`).join(", ") || "none"}`);
