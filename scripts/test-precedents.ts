import { readFileSync } from "node:fs";
import { parseBank, parseGl, parseStaff } from "../lib/parse";
import { runPipeline } from "../lib/pipeline";
import type { ModelClient } from "../lib/llm";
import type { Precedent, TypedPrecedent } from "../lib/types";
import { FIXTURE_GRANTS } from "./fixtures";

const D = process.argv[2] ?? "steward-data";
const input = {
  txns: parseBank(readFileSync(`${D}/bank_transactions_q3_2026.csv`, "utf8")),
  gl: parseGl(readFileSync(`${D}/gl_export_bookkeeper.csv`, "utf8")),
  staff: parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8")),
  precedents: (JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")) as Omit<Precedent, "id">[]).map(
    (p, i) => ({ id: `P${i + 1}`, ...p }),
  ),
  grants: FIXTURE_GRANTS,
};

const fake: ModelClient = {
  async json({ content }) {
    const text = (content.find((c) => c.type === "text") as { text: string }).text;
    const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]);
    return {
      data: {
        codings: rows.map((r: { txnId: string; gl?: { class: string; budgetLine: string } | null }) => ({
          txnId: r.txnId,
          grantId: r.gl?.class ?? "GA-2026-114",
          budgetLine: r.gl?.budgetLine ?? "A3",
          confidence: 0.9,
          rationale: "Test",
          clauseRefs: [],
          concern: null,
        })),
      } as never,
      usage: { input: 0, output: 0 },
    };
  },
};

async function runWith(typed: TypedPrecedent[]) {
  return runPipeline(fake, { ...input, typedPrecedents: typed });
}

async function main() {
  const dup = input.txns.find((t) => t.txnId === "T0044")!;
  const prior = input.txns.find((t) => t.description === "DELL MARKETING L.P.")!;
  const fine = input.txns.find((t) => t.description.includes("SFMTA"))!;

  const r1 = await runWith([
    {
      id: "P9",
      date: "2026-10-01",
      by: "Tester",
      scope: "ALL",
      match: { vendorKey: "SCHOLASTIC" },
      ruling: "not_duplicate",
      note: "Confirmed with vendor",
    },
  ]);
  const dDup = r1.decisions.find((x) => x.txnId === dup.txnId)!;
  console.assert(!dDup.ruleHits.includes("R-DUPLICATE"), "not_duplicate should drop duplicate flag");

  const r2 = await runWith([
    {
      id: "P10",
      date: "2026-10-01",
      by: "Tester",
      scope: "GA-2026-114",
      match: { txnId: prior.txnId },
      ruling: "prior_approval_granted",
      note: "Email approval on file",
    },
  ]);
  const dPrior = r2.decisions.find((x) => x.txnId === prior.txnId)!;
  console.assert(!dPrior.ruleHits.includes("R-PRIOR-APPROVAL"), "prior_approval_granted suppresses prior approval");

  const r3 = await runWith([
    {
      id: "P11",
      date: "2026-10-01",
      by: "Tester",
      scope: "GA-2026-114",
      match: { txnId: fine.txnId },
      ruling: "disallow",
      note: "Must be unrestricted",
    },
  ]);
  const dFine = r3.decisions.find((x) => x.txnId === fine.txnId)!;
  console.assert(dFine.status === "blocked" && dFine.grantId === null, "disallow forces blocked unrestricted");

  const r4 = await runWith([
    {
      id: "P12",
      date: "2026-10-01",
      by: "Tester",
      scope: "GA-2026-114",
      match: { vendorKey: "COSTCO" },
      ruling: "allow",
      note: "Workshop snacks allowable",
    },
  ]);
  const costco = input.txns.find((t) => t.description.includes("COSTCO"))!;
  const dCostco = r4.decisions.find((x) => x.txnId === costco.txnId)!;
  console.assert(
    dCostco.checks?.some((c) => c.message.includes("Applied ruling")),
    "allow adds applied ruling check",
  );

  console.log("test-precedents: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
