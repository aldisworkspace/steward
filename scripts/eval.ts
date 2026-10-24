/**
 * Score Convex decisions against the steward-data answer key (eval only — never import expected_* from app code).
 */
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";

const D = process.argv[2] ?? "steward-data";
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  console.error("NEXT_PUBLIC_CONVEX_URL is not set");
  process.exit(1);
}

async function main() {
const client = new ConvexHttpClient(url!);
const decisions: Doc<"decisions">[] = await client.query(api.dashboard.listDecisionsRaw, {});

const exp = JSON.parse(readFileSync(`${D}/expected_labels.json`, "utf8"));
const expGl = JSON.parse(readFileSync(`${D}/expected_gl_findings.json`, "utf8"));
const issues = new Set<string>([
  ...exp.filter((e: { issue?: boolean; id: string }) => e.issue).map((e: { id: string }) => e.id),
  ...expGl.map((e: { id: string }) => e.id),
]);
const flagged = new Set(decisions.filter((d) => d.status !== "auto").map((d) => d.txnId));
const tp = [...flagged].filter((id) => issues.has(id)).length;

let ok = 0;
let n = 0;
const wrong: string[] = [];
for (const e of exp) {
  if (issues.has(e.id)) continue;
  const d = decisions.find((x) => x.txnId === e.id);
  if (!d) {
    wrong.push(`${e.id} missing decision`);
    n++;
    continue;
  }
  n++;
  const want = e.grant === "UNRESTRICTED" || e.grant === "INCOME" ? null : e.grant;
  const good =
    e.grant === "SPLIT"
      ? !!d.splits
      : (d.grantId ?? null) === want && (want === null || d.budgetLine === e.line);
  if (good) ok++;
  else wrong.push(`${e.id} ${e.description} want ${want}:${e.line} got ${d.grantId}:${d.budgetLine}`);
}

const out = {
  issueRecall: `${tp}/${issues.size}`,
  issuePrecision: `${tp}/${flagged.size}`,
  falsePositives: [...flagged].filter((id) => !issues.has(id)),
  codingAccuracy: `${ok}/${n}`,
  misses: wrong,
};
console.log(JSON.stringify(out, null, 2));
console.log(`Issue recall ${tp}/${issues.size}, precision ${tp}/${flagged.size}`);
console.log(`False positives: ${out.falsePositives.join(", ") || "none"}`);
console.log(`Coding accuracy on clean rows: ${ok}/${n}`);
if (wrong.length) console.log(wrong.slice(0, 10).join("\n"));

process.exit(tp === issues.size && tp === flagged.size ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
