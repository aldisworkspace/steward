/**
 * Billing package segregation of duties, against the real Convex mutation handlers with an in-memory db:
 * preparer cannot sign, "Steward" can hold no role, unknown names are rejected, failing checks block signing.
 * Offline regression check (SYNTHETIC fixtures), not a deployed smoke test.
 *   npx tsx scripts/test-packages-sod.ts
 */
import assert from "node:assert/strict";
import { markReady, reopen, sign } from "../convex/packages";
import { approveDepartment, approveLines } from "../convex/programApprovals";
import { update as updateSettings } from "../convex/settings";
import type { MutationCtx } from "../convex/_generated/server";
import { FIXTURE_GRANTS_V2 } from "./fixturesV2";

type Row = { _id: string; [key: string]: unknown };
const passcode = "test-only-passcode";
function handler<Args, R = unknown>(registered: unknown) {
  const h = (registered as { _handler: (ctx: MutationCtx, args: Args) => Promise<R> })._handler;
  assert.equal(typeof h, "function");
  return h;
}
const markReadyH = handler<{ grantId: string; periodStart: string; periodEnd: string; by: string; passcode: string }, string>(markReady);
const signH = handler<{ packageId: string; by: string; passcode: string }>(sign);
const approveLinesH = handler<{ txnIds: string[]; by: string; passcode: string }, number>(approveLines);
const approveDeptH = handler<{ department: string; grantId?: string; by: string; passcode: string }, number>(approveDepartment);
const settingsH = handler<Record<string, unknown>>(updateSettings);
const reopenH = handler<{ packageId: string; by: string; reason: string; passcode: string }>(reopen);

const OKAFOR = "A. Okafor (Executive Director)";
const RIVERA = "J. Rivera (Staff Accountant)";
const CHEN = "M. Chen (Program Director)";

function fixture() {
  const line = (txnId: string, date: string, vendor: string, cents: number, cls: string, bl: string, extra: Record<string, unknown> = {}) => ({
    _id: `t-${txnId}`, txnId, date, description: vendor, vendor, amountCents: cents, memo: "", source: "gl", account: "6100 Supplies",
    docRef: "", txnType: "Expense", glClass: cls, glBudgetLine: bl, enteredBy: "bookkeeper", department: "", programApprovedBy: CHEN, ...extra,
  });
  const tables: Record<string, Row[]> = {
    grants: [{ _id: "g1", status: "ready", terms: { ...FIXTURE_GRANTS_V2[0]!, indirectCapPct: null, indirectBase: null }, grantId: "FS-27-0412", fileName: "c.pdf" }],
    transactions: [
      line("L1", "2026-07-09", "Office Depot", -8000, "FS-27-0412", "C3"),
      line("L2", "2026-07-12", "Clipper", -4000, "FS-27-0412", "C5"),
    ],
    decisions: [
      { _id: "d1", txnId: "L1", grantId: "FS-27-0412", budgetLine: "C3", status: "auto", ruleHits: [], rationale: "" },
      { _id: "d2", txnId: "L2", grantId: "FS-27-0412", budgetLine: "C5", status: "auto", ruleHits: [], rationale: "" },
    ],
    receipts: [], inboxResolutions: [], packages: [], glRows: [], auditLog: [],
    workspaceSettings: [{ _id: "s1", key: "default", organizationName: "SYNTHETIC Org", approverName: "A. Okafor", approverTitle: "Executive Director",
      dataSource: "custom", preparers: [RIVERA, OKAFOR], reviewers: [OKAFOR, "Controller"], programApprovers: [CHEN] }],
  };
  let seq = 0;
  const all = () => Object.values(tables).flat();
  const db = {
    query(table: string) {
      let rows = tables[table] ?? [];
      const q = {
        withIndex(_n: string, f: (q: { eq: (k: string, v: unknown) => unknown }) => void) {
          const conds: [string, unknown][] = [];
          const b = { eq(k: string, v: unknown) { conds.push([k, v]); return b; } };
          f(b);
          rows = rows.filter((r) => conds.every(([k, v]) => r[k] === v));
          return q;
        },
        async collect() { return rows.map((r) => structuredClone(r)); },
        async first() { return rows[0] ? structuredClone(rows[0]) : null; },
      };
      return q;
    },
    async get(id: string) { const r = all().find((x) => x._id === id); return r ? structuredClone(r) : null; },
    async patch(id: string, patch: Record<string, unknown>) { const r = all().find((x) => x._id === id); assert.ok(r, `missing ${id}`); Object.assign(r, patch); },
    async insert(table: string, value: Record<string, unknown>) { const id = `${table}-${++seq}`; (tables[table] ??= []).push({ ...value, _id: id }); return id; },
  };
  const ctx = { db } as unknown as MutationCtx;
  const period = { grantId: "FS-27-0412", periodStart: "2026-07-01", periodEnd: "2026-07-31", passcode };
  return {
    tables,
    ready: (by: string) => markReadyH(ctx, { ...period, by }),
    sign: (packageId: string, by: string) => signH(ctx, { packageId, by, passcode }),
    reopen: (packageId: string, by: string, reason: string) => reopenH(ctx, { packageId, by, reason, passcode }),
    approve: (txnIds: string[], by: string) => approveLinesH(ctx, { txnIds, by, passcode }),
    approveDept: (department: string, by: string, grantId?: string) => approveDeptH(ctx, { department, grantId, by, passcode }),
    settings: (args: Record<string, unknown>) => settingsH(ctx, { ...args, passcode }),
  };
}

async function main() {
  const prev = process.env.DEMO_PASSCODE;
  process.env.DEMO_PASSCODE = passcode;
  try {
    // Steward and unknown names hold no role
    const f0 = fixture();
    await assert.rejects(() => f0.ready("Steward"), /Segregation of duties/);
    await assert.rejects(() => f0.ready("steward (auto)"), /Segregation of duties/);
    await assert.rejects(() => f0.ready("Somebody Else"), /Unknown preparer/);
    assert.equal(f0.tables.packages.length, 0);

    // preparer cannot sign their own package (even when they are also a reviewer)
    const f1 = fixture();
    const id = await f1.ready(OKAFOR);
    assert.equal(f1.tables.packages[0]!.status, "ready_for_review");
    const before = structuredClone(f1.tables.packages);
    await assert.rejects(() => f1.sign(id, OKAFOR), /preparer of a package cannot sign/);
    await assert.rejects(() => f1.sign(id, "Steward"), /Segregation of duties/);
    await assert.rejects(() => f1.sign(id, RIVERA), /Unknown reviewer/, "a preparer-only person cannot sign");
    assert.deepEqual(f1.tables.packages, before, "denied signing changes nothing");

    // failing check blocks signing: the $80 Office Depot line has no receipt
    const f2 = fixture();
    const id2 = await f2.ready(RIVERA);
    await assert.rejects(() => f2.sign(id2, OKAFOR), /Cannot sign: RECEIPTS/);
    assert.equal(f2.tables.packages[0]!.status, "ready_for_review");
    assert.equal(f2.tables.packages[0]!.snapshot, null);

    // fix it → signs, snapshot frozen, audited
    f2.tables.receipts.push({ _id: "r1", status: "ready", fileName: "od.pdf", matchedTxnId: "L1" });
    await f2.sign(id2, OKAFOR);
    const p = f2.tables.packages[0]!;
    assert.equal(p.status, "signed");
    assert.equal(p.reviewedBy, OKAFOR);
    assert.equal((p.snapshot as { invoiceTotalCents: number }).invoiceTotalCents, 12000);
    await assert.rejects(() => f2.sign(id2, "Controller"), /only a package ready for review/);
    await assert.rejects(() => f2.ready(RIVERA), /already signed/);

    // reopen needs a reason, is logged, and discards the snapshot
    await assert.rejects(() => f2.reopen(id2, OKAFOR, " "), /Say why/);
    await f2.reopen(id2, OKAFOR, "City asked to split C3 by program");
    assert.equal(f2.tables.packages[0]!.status, "draft");
    assert.equal(f2.tables.packages[0]!.snapshot, null);
    assert.deepEqual(f2.tables.auditLog.map((a) => a.action), ["package_ready", "package_signed", "package_reopened"]);
    // program approval: role-checked, never Steward, not by the person who entered the line, bulk by department
    const f3 = fixture();
    for (const t of f3.tables.transactions) { t.programApprovedBy = null; t.department = "Family Resource Center"; }
    f3.tables.transactions.push({ ...structuredClone(f3.tables.transactions[0]!), _id: "t-L3", txnId: "L3", department: "Youth Mentoring" });
    f3.tables.glRows.push({ _id: "gl1", bankRef: "L1", enteredBy: CHEN });
    await assert.rejects(() => f3.approve(["L2"], "Steward"), /Segregation of duties/);
    await assert.rejects(() => f3.approve(["L2"], OKAFOR), /Unknown program approver/);
    await assert.rejects(() => f3.approve(["L1"], CHEN), /entered L1 and cannot approve/);
    await assert.rejects(() => f3.approveDept("Family Resource Center", CHEN), /entered L1/, "bulk is all-or-nothing");
    assert.ok(f3.tables.transactions.every((t) => !t.programApprovedBy));
    f3.tables.glRows.length = 0;
    assert.equal(await f3.approveDept("Family Resource Center", CHEN, "FS-27-0412"), 2);
    assert.deepEqual(f3.tables.transactions.map((t) => t.programApprovedBy), [CHEN, CHEN, null]);
    assert.equal(f3.tables.auditLog.at(-1)!.action, "program_approve");
    await assert.rejects(() => f3.approveDept("Family Resource Center", CHEN), /No GL lines/, "already approved");

    // role lists are configurable; Steward can never be put in one
    await assert.rejects(() => f3.settings({ reviewers: ["Steward"] }), /Steward cannot hold/);
    await assert.rejects(() => f3.settings({ preparers: [" "] }), /at least one/);
    await f3.settings({ programApprovers: ["P. Diaz (Program Manager)"] });
    await assert.rejects(() => f3.approve(["L3"], CHEN), /Unknown program approver/);
    assert.equal(await f3.approve(["L3"], "P. Diaz (Program Manager)"), 1);
    console.log("test-packages-sod: all segregation-of-duties assertions passed");
  } finally {
    if (prev === undefined) delete process.env.DEMO_PASSCODE; else process.env.DEMO_PASSCODE = prev;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
