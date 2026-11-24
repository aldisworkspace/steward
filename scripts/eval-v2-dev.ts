/**
 * Score a GL-first dataset (default steward-data-v2) as it currently stands on the Convex DEV deployment.
 * Eval only: this script may read the answer key (expected_v2.json); app code never does.
 *
 *   npx tsx scripts/eval-v2-dev.ts                 # dump dev via `npx convex run` and score
 *   npx tsx scripts/eval-v2-dev.ts --save out.json # also save the raw dump
 *   npx tsx scripts/eval-v2-dev.ts --from out.json # score a saved dump (offline)
 *   npx tsx scripts/eval-v2-dev.ts --dir steward-holdout-v2 # score against that folder's expected_v2.json
 *
 * Reads through internal queries (evalDev:dump) and the public packages:list / packages:get with
 * `npx convex run` (the CLI handles auth and targets dev by default; never --prod).
 * Exit code is non-zero only for script errors, not for a bad score.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

type GlRef = { date: string; num: string; name: string; amount: string; class: string; account: string };
type Issue = { id: string; kind: string; glRef: GlRef; expectedRule: string; expectedStatus: string; relatedRefs?: GlRef[];
  correctIndirectCents?: number; bookedIndirectCents?: number };
type ExpPackage = { grant: string; period: string; glBookedTotalCents: number; expectedInvoiceTotalCents: number;
  excludedIssueIds: string[]; expectedChecksFailing: string[]; indirect?: { correctCents: number; bookedCents: number } };
type Expected = { issues: Issue[]; clean: GlRef[]; packages: ExpPackage[] };

type Txn = { txnId: string; date: string; amountCents: number; memo: string; source?: string; vendor?: string; description: string;
  docRef?: string; account?: string; glClass?: string | null; glBudgetLine?: string | null; txnType?: string };
type Check = { ruleId: string | null; label: string; message: string };
type Decision = { txnId: string; status: string; grantId: string | null; budgetLine: string | null; ruleHits: string[];
  rationale: string; checks?: Check[]; confidence: number; splits?: { grantId: string | null; amount: number }[] };
type Dump = { transactions: Txn[]; decisions: Decision[]; receipts: { fileName: string; matchedTxnId: string | null; matchCandidates: string[] }[];
  lastRun: { status: string; errors: string[] } | null;
  packages: { grantId: string; periodStart: string; periodEnd: string; invoiceTotalCents: number; failing: string[];
    checks?: { id: string; pass: boolean; detail: string }[] }[] };

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dataDir = (opt("--dir") ?? "steward-data-v2").replace(/\/+$/, "");
const usd = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

function convexRun(fn: string, fnArgs: object = {}): unknown {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(fnArgs)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const start = out.search(/[[{]/);
  if (start < 0) throw new Error(`convex run ${fn}: no JSON in output`);
  return JSON.parse(out.slice(start));
}

function loadDump(): Dump {
  const from = opt("--from");
  if (from) return JSON.parse(readFileSync(from, "utf8")) as Dump;
  const base = convexRun("evalDev:dump") as Omit<Dump, "packages">;
  const list = convexRun("packages:list") as { grantId: string; periodStart: string; periodEnd: string }[];
  const packages = list.map((p) => {
    const g = convexRun("packages:get", { grantId: p.grantId, periodStart: p.periodStart, periodEnd: p.periodEnd }) as
      Dump["packages"][number] & { package?: { checks: { id: string; pass: boolean; detail: string }[] } };
    return { grantId: g.grantId, periodStart: g.periodStart, periodEnd: g.periodEnd, invoiceTotalCents: g.invoiceTotalCents,
      failing: g.failing, checks: g.package?.checks.map(({ id, pass, detail }) => ({ id, pass, detail })) };
  });
  const dump = { ...base, packages };
  const save = opt("--save");
  if (save) writeFileSync(save, JSON.stringify(dump, null, 1));
  return dump;
}

const cents = (s: string) => Math.round(Number(s) * 100);
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function lineFor(ref: GlRef, txns: Txn[]): Txn | null {
  const [cls, line] = ref.class === "General" ? [null, null] : ref.class.split(":");
  const hits = txns.filter((t) => t.source === "gl" && t.date === ref.date && t.amountCents === -cents(ref.amount) &&
    norm(t.docRef) === norm(ref.num) && (!ref.name || norm(t.vendor ?? t.description) === norm(ref.name)) &&
    (t.glClass ?? null) === cls && (t.glBudgetLine ?? null) === line && (!ref.account || t.account === ref.account));
  return hits.length === 1 ? hits[0]! : null;
}

function main() {
  const exp = JSON.parse(readFileSync(`${dataDir}/expected_v2.json`, "utf8")) as Expected;
  const dump = loadDump();
  const dById = new Map(dump.decisions.map((d) => [d.txnId, d]));
  const flagged = (id: string) => (dById.get(id)?.status ?? "missing") !== "auto";
  const pkgOf = (grant: string, period: string) => dump.packages.find((p) => p.grantId === grant && p.periodStart.slice(0, 7) === period);

  console.log(`Dataset: ${dataDir}`);
  console.log(`Run: ${dump.lastRun?.status ?? "none"}${dump.lastRun?.errors.length ? ` errors=${dump.lastRun.errors.join(" | ")}` : ""}`);
  console.log(`Lines ${dump.transactions.length}, decisions ${dump.decisions.length}, open ${dump.decisions.filter((d) => d.status !== "auto").length}\n`);

  // ---- planted issues
  let caught = 0, statusOk = 0;
  const related = new Set<string>();
  console.log("PLANTED ISSUES");
  for (const is of exp.issues) {
    const t = lineFor(is.glRef, dump.transactions);
    for (const r of is.relatedRefs ?? []) { const rt = lineFor(r, dump.transactions); if (rt) related.add(rt.txnId); }
    if (!t) { console.log(`  ${is.id} ${is.kind}: NO LINE FOUND for ${JSON.stringify(is.glRef)}`); continue; }
    const d = dById.get(t.txnId);
    let hit = !!d && d.status !== "auto";
    let how = d ? `${d.status} [${d.ruleHits.join(", ") || "no rule"}]` : "no decision";
    if (is.kind === "indirect_rate") {
      const p = pkgOf(is.glRef.class.split(":")[0]!, is.glRef.date.slice(0, 7));
      const c = p?.checks?.find((x) => x.id === "INDIRECT_ROUNDING");
      const pkgHit = !!c && !c.pass && c.detail.includes(usd(is.correctIndirectCents ?? 0).slice(1)) && c.detail.includes(usd(is.bookedIndirectCents ?? 0).slice(1));
      how += `; package INDIRECT_ROUNDING ${c ? (c.pass ? "passes" : `fails: ${c.detail}`) : "missing"}`;
      hit = hit || pkgHit;
    }
    const sOk = d?.status === is.expectedStatus;
    if (hit) caught++;
    if (hit && sOk) statusOk++;
    console.log(`  ${hit ? "CAUGHT" : "MISSED"} ${is.id} ${is.kind} ${t.txnId} expected ${is.expectedStatus} (${is.expectedRule}) → ${how}${hit && !sOk ? "  (status differs)" : ""}`);
  }
  console.log(`  => caught ${caught}/${exp.issues.length}, status match ${statusOk}/${exp.issues.length}\n`);

  // ---- false alarms on clean lines
  const fas: string[] = [];
  let mapped = 0;
  for (const ref of exp.clean) {
    const t = lineFor(ref, dump.transactions);
    if (!t) { fas.push(`  UNMAPPED clean ref ${JSON.stringify(ref)}`); continue; }
    mapped++;
    if (!flagged(t.txnId)) continue;
    const d = dById.get(t.txnId)!;
    const why = (d.checks ?? []).map((c) => `${c.ruleId ?? c.label}: ${c.message}`).join(" || ") || d.rationale;
    fas.push(`  ${t.txnId} ${t.date} ${t.vendor ?? t.description} ${usd(t.amountCents)} ${t.glClass ?? "General"}${t.glBudgetLine ? ":" + t.glBudgetLine : ""} → ${d.status} [${d.ruleHits.join(", ") || "no rule"}] conf ${d.confidence}\n      model: ${d.rationale}\n      checks: ${why}`);
  }
  console.log(`FALSE ALARMS on clean lines: ${fas.filter((f) => !f.includes("UNMAPPED")).length}/${exp.clean.length} (mapped ${mapped})`);
  for (const f of fas) console.log(f);
  const relFlag = [...related].filter(flagged);
  console.log(`  related lines (issue context, not scored): ${[...related].map((id) => `${id}=${dById.get(id)?.status ?? "?"}`).join(", ")}${relFlag.length ? "" : ""}\n`);

  // ---- packages
  console.log("PACKAGES (invoice total vs expected)");
  for (const p of exp.packages) {
    const got = pkgOf(p.grant, p.period);
    if (!got) { console.log(`  ${p.grant} ${p.period}: NO PACKAGE`); continue; }
    const diff = got.invoiceTotalCents - p.expectedInvoiceTotalCents;
    console.log(`  ${p.grant} ${p.period}: ${usd(got.invoiceTotalCents)} vs expected ${usd(p.expectedInvoiceTotalCents)} (booked ${usd(p.glBookedTotalCents)}) ${diff ? `DIFF ${usd(diff)}` : "ties"}`
      + ` · failing [${got.failing.join(", ")}] · key excludes [${p.excludedIssueIds.join(", ")}] expects failing [${p.expectedChecksFailing.join(", ")}]`);
    const ind = got.checks?.find((c) => c.id === "INDIRECT_ROUNDING");
    if (ind && !ind.pass) console.log(`      INDIRECT_ROUNDING: ${ind.detail}`);
  }
  if (dataDir.endsWith("steward-data-v2")) console.log("  note: the key's convention lists D-a as needs_review (included at booked amount) but the 2026-08 package still excludes it; a D-a difference of $166.22 is that inconsistency. The key also restates indirect to the computed amount; the app reports the difference as a failing check instead.");
}

try { main(); } catch (e) { console.error(`eval-v2-dev: ${(e as Error).message}`); process.exit(1); }
