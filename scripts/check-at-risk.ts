/**
 * Offline at-risk totals (pipeline decisions) — should match Overview / Inbox when demo is seeded.
 */
import { readFileSync } from "node:fs";
import type { ModelClient } from "../lib/llm";
import { parseBank, parseGl, parseStaff } from "../lib/parse";
import { runPipeline } from "../lib/pipeline";
import type { Precedent } from "../lib/types";
import { FIXTURE_GRANTS } from "./fixtures";

const D = process.argv[2] ?? "steward-data";

const NAIVE: [RegExp, string | null, string | null][] = [
  [/DELL MARKETING/, "GA-2026-114", "A3"],
  [/SFMTA/, "GA-2026-114", "A5"],
  [/PALACE OF FINE ARTS/, "HLF-26-031", "B4"],
  [/BAY AREA DISCOVERY|ACADEMY OF SCI|EXPLORATORIUM|CHARTER BUS/, "HLF-26-031", "B3"],
  [/SCHOLASTIC|GREEN APPLE|DEMCO|LAKESHORE/, "HLF-26-031", "B2"],
  [/VENMO/, "GA-2026-114", "A4"],
  [/CLIPPER/, "GA-2026-114", "A5"],
  [/AMAZON|OFFICE DEPOT|STAPLES|COSTCO|TAQUERIA/, "GA-2026-114", "A3"],
];

const fake: ModelClient = {
  async json({ content }) {
    const text = (content.find((c) => c.type === "text") as { text: string }).text;
    const rows = JSON.parse(text.match(/<transactions>([\s\S]*)<\/transactions>/)![1]);
    const codings = rows.map((r: { txnId: string; amountUsd: number; memo?: string; gl?: { class: string; budgetLine: string }; description: string; vendorHistory?: { grantId: string; budgetLine: string }[] }) => {
      if (r.amountUsd > 0)
        return { txnId: r.txnId, grantId: r.gl?.class ?? null, budgetLine: r.gl?.budgetLine ?? null, confidence: 0.95, rationale: "Income / refund.", clauseRefs: [], concern: null };
      if (process.env.CAUTIOUS && !r.memo && r.amountUsd > -250) {
        const h = r.vendorHistory?.[0];
        if (process.env.CAUTIOUS === "history" && h)
          return { txnId: r.txnId, grantId: h.grantId, budgetLine: h.budgetLine, confidence: 0.8, rationale: "Follows vendor history; no memo.", clauseRefs: [], concern: null };
        return { txnId: r.txnId, grantId: null, budgetLine: null, confidence: 0.6, rationale: "No memo; unclear purpose.", clauseRefs: [], concern: null };
      }
      if (r.gl) return { txnId: r.txnId, grantId: r.gl.class, budgetLine: r.gl.budgetLine, confidence: 0.9, rationale: "Matches bookkeeper coding.", clauseRefs: [], concern: null };
      const n = NAIVE.find(([re]) => re.test(r.description));
      return { txnId: r.txnId, grantId: n?.[1] ?? null, budgetLine: n?.[2] ?? null, confidence: n ? 0.8 : 0.9, rationale: n ? "Vendor pattern." : "General operations.", clauseRefs: [], concern: null };
    });
    return { data: { codings } as never, usage: { input: 0, output: 0 } };
  },
};

async function main() {
  const input = {
    txns: parseBank(readFileSync(`${D}/bank_transactions_q3_2026.csv`, "utf8")),
    gl: parseGl(readFileSync(`${D}/gl_export_bookkeeper.csv`, "utf8")),
    staff: parseStaff(readFileSync(`${D}/staff_allocation.csv`, "utf8")),
    precedents: (JSON.parse(readFileSync(`${D}/precedents.json`, "utf8")) as Omit<Precedent, "id">[]).map((p, i) => ({
      id: `P${i + 1}`,
      ...p,
    })),
    grants: FIXTURE_GRANTS,
  };

  const res = await runPipeline(fake, input);
  const byTxn = new Map(input.txns.map((t) => [t.txnId, t]));
  let atRiskCents = 0;
  let openCount = 0;
  for (const d of res.decisions) {
    if (d.status === "auto") continue;
    openCount++;
    const t = byTxn.get(d.txnId);
    if (!t || t.amountCents >= 0) continue;
    atRiskCents += d.atRiskCents ?? 0;
  }
  const dollars = Math.round(atRiskCents / 100);
  console.log(`Pipeline open exceptions: ${openCount}`);
  console.log(`Sum atRiskCents (outflows): ${atRiskCents} ($${dollars.toLocaleString("en-US")})`);
  console.log("Live app: Overview at-risk = Inbox header = sum of queue row atRiskCents (open items).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
