/**
 * Score a GL-first dataset (default steward-data-v2) as it currently stands on the Convex DEV deployment.
 * Eval only: this script may read the answer key (expected_v2.json); app code never does.
 *
 *   npx tsx scripts/eval-v2-dev.ts                 # dump dev via `npx convex run` and score
 *   npx tsx scripts/eval-v2-dev.ts --save out.json # also save the raw dump
 *   npx tsx scripts/eval-v2-dev.ts --from out.json # score a saved dump (offline)
 *   npx tsx scripts/eval-v2-dev.ts --dir steward-holdout-v2 # score against that folder's expected_v2.json
 *   npx tsx scripts/eval-v2-dev.ts --dir steward-holdout-v3 # expected_v3.json: also compares blocked cents
 *   npx tsx scripts/eval-v2-dev.ts --dir steward-holdout-v4 # expected_v4.json (v3 schema)
 *
 * Reads through internal queries (evalDev:dump) and the public packages:list / packages:get with
 * `npx convex run` (the CLI handles auth and targets dev by default; never --prod).
 * Exit code is non-zero only for script errors, not for a bad score.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// v2 keys carry `class`/`account` on every ref and ISO dates; v3 keys use MM/DD/YYYY, put an issue's class in
// `cls` and may omit `account`. normRef() maps both to one shape.
type GlRef = { date: string; num: string; name: string; amount: string; class: string; account?: string; cls?: string; note?: string };
type Issue = { id: string; kind: string; glRef: GlRef; expectedRule?: string; clause?: string; expectedStatus: string; relatedRefs?: GlRef[];
  correctIndirectCents?: number; bookedIndirectCents?: number; cls?: string; blockedCents?: number; note?: string };
type ExpPackage = { grant: string; period: string; glBookedTotalCents?: number; expectedInvoiceTotalCents: number;
  excludedIssueIds?: string[]; expectedChecksFailing?: string[]; indirect?: { correctCents: number; bookedCents: number } };
type Expected = { issues: Issue[]; clean: GlRef[]; packages: ExpPackage[]; grants?: { id: string; basis: string }[] };

type Txn = { txnId: string; date: string; amountCents: number; memo: string; source?: string; vendor?: string; description: string;
  docRef?: string; account?: string; glClass?: string | null; glBudgetLine?: string | null; txnType?: string };
type Check = { ruleId: string | null; label: string; message: string };
type Decision = { txnId: string; status: string; grantId: string | null; budgetLine: string | null; ruleHits: string[];
  rationale: string; atRiskCents?: number; checks?: Check[]; confidence: number; splits?: { grantId: string | null; amount: number }[] };
type Dump = { transactions: Txn[]; decisions: Decision[]; receipts: { fileName: string; matchedTxnId: string | null; matchCandidates: string[] }[];
  lastRun: { status: string; errors: string[] } | null;
  packages: { grantId: string; periodStart: string; periodEnd: string; invoiceTotalCents: number; failing: string[];
    glTotalCents?: number; excluded?: { txnId: string; amountCents: number }[];
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
      Dump["packages"][number] & { package?: { glTotalCents: number; excluded: { txnId: string; amountCents: number }[];
        checks: { id: string; pass: boolean; detail: string }[] } };
    return { grantId: g.grantId, periodStart: g.periodStart, periodEnd: g.periodEnd, invoiceTotalCents: g.invoiceTotalCents,
      failing: g.failing, glTotalCents: g.package?.glTotalCents,
      excluded: g.package?.excluded.map(({ txnId, amountCents }) => ({ txnId, amountCents })),
      checks: g.package?.checks.map(({ id, pass, detail }) => ({ id, pass, detail })) };
  });
  const dump = { ...base, packages };
  const save = opt("--save");
  if (save) writeFileSync(save, JSON.stringify(dump, null, 1));
  return dump;
}

const cents = (s: string) => Math.round(Number(s) * 100);
const isoDate = (d: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d); return m ? `${m[3]}-${m[1]}-${m[2]}` : d; };
const normRef = (r: GlRef, cls?: string): GlRef => ({ ...r, date: isoDate(r.date), class: r.class ?? r.cls ?? cls ?? "General" });
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function lineFor(ref: GlRef, txns: Txn[]): Txn | null {
  const [cls, line] = ref.class === "General" ? [null, null] : ref.class.split(":");
  const hits = txns.filter((t) => t.source === "gl" && t.date === ref.date && t.amountCents === -cents(ref.amount) &&
    norm(t.docRef) === norm(ref.num) && (!ref.name || norm(t.vendor ?? t.description) === norm(ref.name)) &&
    (t.glClass ?? null) === cls && (t.glBudgetLine ?? null) === line && (!ref.account || t.account === ref.account));
  return hits.length === 1 ? hits[0]! : null;
}

function main() {
  // Newest key schema first; v4 uses the v3 schema.
  const keyFile = ["expected_v4.json", "expected_v3.json", "expected_v2.json"].find((f) => existsSync(`${dataDir}/${f}`)) ?? "expected_v2.json";
  const raw = JSON.parse(readFileSync(`${dataDir}/${keyFile}`, "utf8")) as Expected;
  const exp: Expected = { ...raw,
    issues: raw.issues.map((is) => ({ ...is, glRef: normRef(is.glRef, is.cls), relatedRefs: is.relatedRefs?.map((r) => normRef(r)) })),
    clean: raw.clean.map((r) => normRef(r)) };
  const dump = loadDump();
  const dById = new Map(dump.decisions.map((d) => [d.txnId, d]));
  const flagged = (id: string) => (dById.get(id)?.status ?? "missing") !== "auto";
  const pkgOf = (grant: string, period: string) => dump.packages.find((p) => p.grantId === grant && p.periodStart.slice(0, 7) === period);

  console.log(`Dataset: ${dataDir} (key ${keyFile})`);
  console.log(`Run: ${dump.lastRun?.status ?? "none"}${dump.lastRun?.errors.length ? ` errors=${dump.lastRun.errors.join(" | ")}` : ""}`);
  console.log(`Lines ${dump.transactions.length}, decisions ${dump.decisions.length}, open ${dump.decisions.filter((d) => d.status !== "auto").length}\n`);

  // ---- planted issues
  let caught = 0, statusOk = 0, centsOk = 0, centsN = 0;
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
    let cents = "";
    if (is.blockedCents != null) {
      // Steward's blocked portion is the decision's at-risk amount when blocked; the live package only excludes
      // it once a person approves the recode, so the package exclusion for the line is shown separately.
      const got = d?.status === "blocked" ? (d.atRiskCents ?? 0) : 0;
      const pkgEx = dump.packages.flatMap((p) => p.excluded ?? []).filter((x) => x.txnId === t.txnId).reduce((a, x) => a + x.amountCents, 0);
      const ok = got === is.blockedCents;
      if (ok) centsOk++;
      centsN++;
      cents = ` · blocked ${usd(got)} vs expected ${usd(is.blockedCents)} ${ok ? "ok" : "DIFF"} (live pkg excludes ${usd(pkgEx)})`;
    }
    console.log(`  ${hit ? "CAUGHT" : "MISSED"} ${is.id} ${is.kind} ${t.txnId} expected ${is.expectedStatus} (${is.expectedRule ?? is.clause}) → ${how}${hit && !sOk ? "  (status differs)" : ""}${cents}`);
  }
  console.log(`  => caught ${caught}/${exp.issues.length}, status match ${statusOk}/${exp.issues.length}${centsN ? `, blocked cents match ${centsOk}/${centsN}` : ""}\n`);

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
    fas.push(`  ${t.txnId} ${t.date}${ref.note ? ` [suspicious-but-clean: ${ref.note}]` : ""} ${t.vendor ?? t.description} ${usd(t.amountCents)} ${t.glClass ?? "General"}${t.glBudgetLine ? ":" + t.glBudgetLine : ""} → ${d.status} [${d.ruleHits.join(", ") || "no rule"}] conf ${d.confidence}\n      model: ${d.rationale}\n      checks: ${why}`);
  }
  console.log(`FALSE ALARMS on clean lines: ${fas.filter((f) => !f.includes("UNMAPPED")).length}/${exp.clean.length} (mapped ${mapped})`);
  for (const f of fas) console.log(f);
  const noted = exp.clean.filter((r) => r.note);
  if (noted.length) console.log(`  suspicious-but-clean lines fired: ${noted.filter((r) => { const t = lineFor(r, dump.transactions); return t && flagged(t.txnId); }).length}/${noted.length}`);
  const relFlag = [...related].filter(flagged);
  console.log(`  related lines (issue context, not scored): ${[...related].map((id) => `${id}=${dById.get(id)?.status ?? "?"}`).join(", ")}${relFlag.length ? "" : ""}\n`);

  // ---- packages
  console.log("PACKAGES (invoice total vs expected)");
  for (const p of exp.packages) {
    const got = pkgOf(p.grant, p.period);
    if (!got) { console.log(`  ${p.grant} ${p.period}: NO PACKAGE`); continue; }
    const diff = got.invoiceTotalCents - p.expectedInvoiceTotalCents;
    console.log(`  ${p.grant} ${p.period}: ${usd(got.invoiceTotalCents)} vs expected ${usd(p.expectedInvoiceTotalCents)} (booked ${usd(p.glBookedTotalCents ?? got.glTotalCents ?? 0)}) ${diff ? `DIFF ${usd(diff)}` : "ties"}`
      + ` · failing [${got.failing.join(", ")}]` + (p.excludedIssueIds ? ` · key excludes [${p.excludedIssueIds.join(", ")}] expects failing [${(p.expectedChecksFailing ?? []).join(", ")}]` : ""));
    if (got.glTotalCents != null) {
      // What the invoice would be once every open blocked finding is approved as Steward sized it (key convention).
      const blocked = dump.transactions.filter((t) => t.source === "gl" && t.glClass === p.grant && t.date.slice(0, 7) === p.period)
        .reduce((a, t) => { const d = dById.get(t.txnId); return a + (d?.status === "blocked" ? (d.atRiskCents ?? 0) : 0); }, 0);
      const proj = got.glTotalCents - blocked;
      console.log(`      if Steward's blocked portions were approved: ${usd(got.glTotalCents)} − ${usd(blocked)} = ${usd(proj)} vs expected ${usd(p.expectedInvoiceTotalCents)} ${proj === p.expectedInvoiceTotalCents ? "ties" : `DIFF ${usd(proj - p.expectedInvoiceTotalCents)}`}`);
    }
    const ind = got.checks?.find((c) => c.id === "INDIRECT_ROUNDING");
    if (ind && !ind.pass) console.log(`      INDIRECT_ROUNDING: ${ind.detail}`);
  }
  for (const g of exp.grants ?? []) {
    if (exp.packages.some((p) => p.grant === g.id)) continue;
    const built = dump.packages.filter((p) => p.grantId === g.id);
    console.log(`  ${g.id} (${g.basis}): key expects no packages; app built ${built.length}${built.length ? ` [${built.map((p) => p.periodStart).join(", ")}]  WRONG` : " ok"}`);
  }
  const extra = dump.packages.filter((p) => !exp.packages.some((e) => e.grant === p.grantId && e.period === p.periodStart.slice(0, 7)) && (exp.grants ?? []).every((g) => g.id !== p.grantId || exp.packages.some((e) => e.grant === g.id)));
  if (extra.length) console.log(`  packages not in key: ${extra.map((p) => `${p.grantId} ${p.periodStart}`).join(", ")}`);
  if (dataDir.endsWith("steward-data-v2")) console.log("  note: the key's convention lists D-a as needs_review (included at booked amount) but the 2026-08 package still excludes it; a D-a difference of $166.22 is that inconsistency. The key also restates indirect to the computed amount; the app reports the difference as a failing check instead.");
}

try { main(); } catch (e) { console.error(`eval-v2-dev: ${(e as Error).message}`); process.exit(1); }
