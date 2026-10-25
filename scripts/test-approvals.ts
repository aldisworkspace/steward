import assert from "node:assert/strict";
import { approveEntry, undoApproveEntry } from "../convex/approvals";
import type { MutationCtx } from "../convex/_generated/server";

// Invoke the real mutation handlers and approver/passcode guards. This is an
// offline regression check, not a replacement for a deployed Convex smoke test.
type Row = { _id: string; [key: string]: unknown };
const human = "A. Okafor (Executive Director)";
const passcode = "test-only-passcode";

// Convex attaches the executable handler at runtime but omits it from the
// public RegisteredMutation type. Keep this test-only access explicit.
function mutationHandler<Args>(registered: unknown) {
  const value = registered as {
    _handler: (ctx: MutationCtx, args: Args) => Promise<void>;
  };
  assert.equal(typeof value._handler, "function");
  return value._handler;
}
const approveHandler = mutationHandler<{
  entryId: string; by: string; note: string; passcode: string;
}>(approveEntry);
const undoHandler = mutationHandler<{
  entryId: string; by: string; passcode: string;
}>(undoApproveEntry);

function fixture() {
  const tables: Record<string, Row[]> = {
    proposedEntries: [{
      _id: "entry1", id: "PE1", txnId: "T1", state: "proposed",
      approvedBy: null, proposedBy: "steward", date: "2026-08-01",
      memo: "Test correction", lines: [],
    }],
    approvals: [], auditLog: [], inboxResolutions: [], workspaceSettings: [], glRows: [],
  };
  let sequence = 0;
  const db = {
    query(table: string) {
      let rows = tables[table] ?? [];
      const query = {
        withIndex(_name: string, filter: (q: { eq: (key: string, value: unknown) => void }) => void) {
          filter({ eq(key, value) { rows = rows.filter((r) => r[key] === value); } });
          return query;
        },
        async collect() { return rows.map((r) => ({ ...r })); },
        async first() { return rows[0] ? { ...rows[0] } : null; },
      };
      return query;
    },
    async patch(id: string, patch: Record<string, unknown>) {
      const row = Object.values(tables).flat().find((r) => r._id === id);
      assert.ok(row, `Missing document ${id}`);
      // Convex schema requires approvedBy; undefined removes the field.
      if (Object.hasOwn(patch, "approvedBy")) {
        assert.ok(patch.approvedBy === null || typeof patch.approvedBy === "string");
      }
      Object.assign(row, patch);
    },
    async insert(table: string, value: Record<string, unknown>) {
      const id = `${table}-${++sequence}`;
      (tables[table] ??= []).push({ ...value, _id: id });
      return id;
    },
    async delete(id: string) {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex((r) => r._id === id);
        if (index !== -1) rows.splice(index, 1);
      }
    },
  };
  const ctx = { db } as unknown as MutationCtx;
  const approve = () => approveHandler(ctx, { entryId: "PE1", by: human, note: "Checked", passcode });
  const undo = (by = human, key = passcode) =>
    undoHandler(ctx, { entryId: "PE1", by, passcode: key });
  return { tables, approve, undo };
}

async function main() {
  const previous = process.env.DEMO_PASSCODE;
  process.env.DEMO_PASSCODE = passcode;
  try {
    const roundTrip = fixture();
    await roundTrip.approve();
    assert.equal(roundTrip.tables.inboxResolutions[0].resolution, "approved_entry");
    await roundTrip.undo();
    assert.equal(roundTrip.tables.proposedEntries[0].state, "proposed");
    assert.equal(roundTrip.tables.proposedEntries[0].approvedBy, null);
    assert.equal(roundTrip.tables.inboxResolutions.length, 0, "Undo must reopen the inbox case");
    assert.equal(roundTrip.tables.approvals.length, 1, "Keep historical approval record");
    assert.deepEqual(roundTrip.tables.auditLog.map((r) => r.action), [
      "approve_entry", "undo_resolution", "undo_approve_entry",
    ]);
    await roundTrip.approve();
    assert.equal(roundTrip.tables.inboxResolutions.length, 1, "Reapproval works after undo");

    const unrelated = fixture();
    await unrelated.approve();
    unrelated.tables.inboxResolutions.push(
      { _id: "other-txn", txnId: "T2", resolution: "approved_entry" },
      ...["acknowledged", "rejected_entry", "overridden"].map((resolution) => ({
        _id: resolution, txnId: "T1", resolution,
      })),
      { _id: "old-duplicate", txnId: "T1", resolution: "approved_entry" },
    );
    await unrelated.undo();
    assert.deepEqual(unrelated.tables.inboxResolutions.map((r) => r._id), [
      "other-txn", "acknowledged", "rejected_entry", "overridden",
    ], "Clear only this transaction's approval resolutions, including stale duplicates");

    for (const state of ["approved", "posted"]) {
      const multiple = fixture();
      await multiple.approve();
      multiple.tables.proposedEntries.push({ _id: "entry2", id: "PE2", txnId: "T1", state });
      await multiple.undo();
      assert.equal(multiple.tables.inboxResolutions.length, 1, `Keep resolution for ${state} sibling`);
    }

    const noResolution = fixture();
    await noResolution.approve();
    noResolution.tables.inboxResolutions.length = 0;
    await noResolution.undo();
    assert.equal(noResolution.tables.proposedEntries[0].state, "proposed");

    for (const [by, key, message] of [
      [human, "incorrect", /passcode/],
      ["Steward", passcode, /Segregation/],
      ["Unknown person", passcode, /Unknown approver/],
    ] as const) {
      const denied = fixture();
      await denied.approve();
      const before = structuredClone(denied.tables);
      await assert.rejects(() => denied.undo(by, key), message);
      assert.deepEqual(denied.tables, before, "Denied undo must not change data");
    }

    const self = fixture();
    await self.approve();
    self.tables.glRows.push({ _id: "gl1", bankRef: "T1", enteredBy: human });
    await assert.rejects(() => self.undo(), /own GL entry/);
    assert.equal(self.tables.proposedEntries[0].state, "approved");

    const invalidState = fixture();
    await assert.rejects(() => invalidState.undo(), /Only approved entries/);
    assert.equal(invalidState.tables.auditLog.length, 0);
    console.log("test-approvals: all mutation regression assertions passed");
  } finally {
    if (previous === undefined) delete process.env.DEMO_PASSCODE;
    else process.env.DEMO_PASSCODE = previous;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
