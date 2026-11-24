/**
 * Demo seeds switch sample sets without losing extracted contracts: the real startGlWorkspace handler runs on an
 * in-memory db; another set's confirmed contracts are parked (by file name) and restored when their set loads.
 * Offline regression check, no Convex deployment.
 *   npx tsx scripts/test-seed-park.ts
 */
import assert from "node:assert/strict";
import { startGlWorkspace } from "../convex/ingest";
import type { MutationCtx } from "../convex/_generated/server";

type Row = { _id: string; [key: string]: unknown };
let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}

const handler = (startGlWorkspace as unknown as { _handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<void> })._handler;

function makeDb() {
  const tables: Record<string, Row[]> = {};
  let seq = 0;
  const all = () => Object.values(tables).flat();
  const db = {
    query(table: string) {
      let rows = (tables[table] ??= []);
      const q = {
        withIndex(_n: string, f: (x: { eq: (k: string, v: unknown) => unknown }) => unknown) {
          f({ eq(k, v) { rows = rows.filter((r) => r[k] === v); return this; } });
          return q;
        },
        filter() { return q; },
        async collect() { return rows.map((r) => ({ ...r })); },
        async first() { return rows[0] ? { ...rows[0] } : null; },
      };
      return q;
    },
    async insert(table: string, value: Record<string, unknown>) {
      const _id = `${table}:${++seq}`;
      (tables[table] ??= []).push({ _id, ...value });
      return _id;
    },
    async patch(id: string, patch: Record<string, unknown>) {
      const row = all().find((r) => r._id === id);
      assert.ok(row, `missing ${id}`);
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete row[k]; else row[k] = v; }
    },
    async delete(id: string) {
      for (const t of Object.keys(tables)) tables[t] = tables[t]!.filter((r) => r._id !== id);
    },
  };
  const ctx = { db, runMutation: async () => undefined } as unknown as MutationCtx;
  return { tables, ctx, db };
}

const line = { txnId: "L0001", date: "2026-07-03", description: "Office Depot", amountCents: -1000, memo: "", source: "gl" as const, vendor: "Office Depot",
  account: "6100", department: "", docRef: "", txnType: "Expense", glClass: null, glBudgetLine: null, enteredBy: "bk" };
const SET_A = ["contract_a.pdf", "grant_a.pdf"];
const SET_B = ["agreement_b.pdf", "grant_b.pdf"];
const seed = (ctx: MutationCtx, keep: string[], park: string[], grantDocIds: string[] = []) =>
  handler(ctx, { lines: [line], bankLines: [], staffAllocations: [], grantDocIds, dataSource: "demo", clearReceipts: true,
    keepGrantFileNames: keep, parkGrantFileNames: park });

async function main() {
  await check("switching sets parks the other set's confirmed contracts and restores them, terms intact", async () => {
    const { tables, ctx, db } = makeDb();
    for (const f of SET_A) await db.insert("grants", { storageId: `st-${f}`, fileName: f, grantId: f.toUpperCase(), terms: { grantId: f.toUpperCase() }, status: "ready", source: "demo" });
    await db.insert("grants", { storageId: "st-legacy", fileName: "grant_A_federal_passthrough.pdf", terms: { grantId: "GA" }, status: "ready", source: "demo" });
    await db.insert("grants", { storageId: "st-half", fileName: "grant_b.pdf", terms: null, status: "error", source: "demo" });

    // Load set B: set A is parked, the legacy grant is dropped, B's own (unread) row is kept for extraction.
    const bRow = tables.grants!.find((g) => g.fileName === "grant_b.pdf")!._id;
    await seed(ctx, SET_B, SET_A, [bRow]);
    assert.deepEqual(tables.grants!.map((g) => g.fileName).sort(), ["grant_b.pdf"]);
    assert.deepEqual(tables.parkedGrants!.map((g) => g.fileName).sort(), SET_A);
    // Set B's contracts get read now.
    await db.patch(bRow, { status: "ready", terms: { grantId: "GRANT_B.PDF" } });
    await db.insert("grants", { storageId: "st-agreement_b.pdf", fileName: "agreement_b.pdf", terms: { grantId: "AGREEMENT_B.PDF" }, status: "ready", source: "demo" });

    // Back to set A: A is restored ready with its terms (no re-extraction), B is parked.
    await seed(ctx, SET_A, SET_B);
    const live = tables.grants!.map((g) => [g.fileName, g.status, (g.terms as { grantId: string }).grantId, g.storageId]).sort();
    assert.deepEqual(live, [["contract_a.pdf", "ready", "CONTRACT_A.PDF", "st-contract_a.pdf"], ["grant_a.pdf", "ready", "GRANT_A.PDF", "st-grant_a.pdf"]]);
    assert.deepEqual(tables.parkedGrants!.map((g) => g.fileName).sort(), SET_B);

    // And B again: restored without re-reading either.
    await seed(ctx, SET_B, SET_A);
    assert.deepEqual(tables.grants!.map((g) => [g.fileName, g.status]).sort(), [["agreement_b.pdf", "ready"], ["grant_b.pdf", "ready"]]);
    assert.deepEqual(tables.parkedGrants!.map((g) => g.fileName).sort(), SET_A);
  });
  await check("a reseed of the same set keeps its contracts and never parks them", async () => {
    const { tables, ctx, db } = makeDb();
    const ids = [];
    for (const f of SET_A) ids.push(await db.insert("grants", { storageId: `st-${f}`, fileName: f, terms: { grantId: f }, status: "ready", source: "demo" }));
    await seed(ctx, SET_A, [...SET_B, ...SET_A], ids);
    assert.equal(tables.grants!.length, 2);
    assert.equal((tables.parkedGrants ?? []).length, 0);
  });

  if (failures) { console.log(`\n${failures} seed-park check(s) failed`); process.exit(1); }
  console.log("\nAll seed-park checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
