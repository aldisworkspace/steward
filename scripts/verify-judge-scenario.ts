/**
 * Acceptance check for judge-scenario bank format (no ledger): fake model copies holdout GL coding.
 *   npx tsx scripts/verify-judge-scenario.ts
 */
import { readFileSync } from "node:fs";
import { detectAndParseBank } from "../lib/parseFlexible";
import { parseGl } from "../lib/parse";
import { runPipeline } from "../lib/pipeline";
import type { ModelClient } from "../lib/llm";
import type { Precedent } from "../lib/types";
import { HOLDOUT_GRANTS } from "./holdoutFixtures";

const JUDGE = "test-fixtures/judge-scenario/bank.csv";
const HOLDOUT = "steward-holdout";

const bankText = readFileSync(JUDGE, "utf8");
const { txns, error } = detectAndParseBank(bankText);
if (error) throw new Error(error);

const gl = parseGl(readFileSync(`${HOLDOUT}/gl_export_bookkeeper.csv`, "utf8"));
const glByRef = new Map(gl.map((g) => [g.bankRef, g]));

const staff = [
  {
    employee: "T. Brooks",
    role: "Program Manager",
    biweeklyCents: 300000,
    allocation: [
      { key: "PCAC-26-0412:C-1", pct: 0.6 },
      { key: "UNRESTRICTED", pct: 0.4 },
    ],
  },
];

const fake: ModelClient = {
  async json({ content }) {
    const text = (content.find((c) => c.type === "text") as { text: string }).text;
    const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]);
    const codings = rows.map((r: { txnId: string; description?: string; gl?: { class: string; budgetLine: string } | null }) => {
      const g = glByRef.get(r.txnId);
      if (g) {
        return {
          txnId: r.txnId,
          grantId: g.class,
          budgetLine: g.budgetLine,
          confidence: 0.9,
          rationale: "Matches bookkeeper coding.",
          clauseRefs: [],
          concern: null,
        };
      }
      if (/UNITED AIRLINES/i.test(r.description ?? "")) {
        return {
          txnId: r.txnId,
          grantId: "PCAC-26-0412",
          budgetLine: "C-5",
          confidence: 0.85,
          rationale: "Travel coded to grant admin line.",
          clauseRefs: [],
          concern: null,
        };
      }
      return {
        txnId: r.txnId,
        grantId: null,
        budgetLine: null,
        confidence: 0.8,
        rationale: "Unrestricted.",
        clauseRefs: [],
        concern: null,
      };
    });
    return { data: { codings } as never, usage: { input: 0, output: 0 } };
  },
};

const MUST_FLAG = [
  { id: "T0024", label: "lobbying (Capitol Strategies)" },
  { id: "T0031", label: "fine + prompt-injection memo" },
  { id: "T0035", label: "wine reception (Bottle & Barrel)" },
  { id: "T0047", label: "Giants tickets (staff entertainment)" },
  { id: "T0061", label: "United out-of-state flight" },
  { id: "T0044", label: "adult ceramics (restricted purpose)" },
];

async function main() {
  const res = await runPipeline(fake, {
    txns,
    gl: [],
    staff,
    precedents: [] as Precedent[],
    grants: HOLDOUT_GRANTS,
  });
  console.log(`Parsed ${txns.length} bank rows from judge CSV format.`);
  for (const m of MUST_FLAG) {
    const d = res.decisions.find((x) => x.txnId === m.id);
    const flagged = d && d.status !== "auto";
    console.log(`${flagged ? "✓" : "✗"} ${m.id} ${m.label}: ${d?.status ?? "missing"} rules=${d?.ruleHits.join(",") || "-"}`);
  }
  const missed = MUST_FLAG.filter((m) => {
    const d = res.decisions.find((x) => x.txnId === m.id);
    return !d || d.status === "auto";
  });
  if (missed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
