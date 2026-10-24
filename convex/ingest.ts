import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertDemoPasscode } from "./passcode";

const txn = v.object({
  txnId: v.string(),
  date: v.string(),
  description: v.string(),
  amountCents: v.number(),
  memo: v.string(),
});

const glRow = v.object({
  bankRef: v.string(),
  date: v.string(),
  description: v.string(),
  amountCents: v.number(),
  account: v.string(),
  class: v.union(v.string(), v.null()),
  budgetLine: v.union(v.string(), v.null()),
  enteredBy: v.string(),
});

const staffAllocation = v.object({
  employee: v.string(),
  role: v.string(),
  biweeklyCents: v.number(),
  allocation: v.array(v.object({ key: v.string(), pct: v.number() })),
});

const precedent = v.object({
  date: v.string(),
  by: v.string(),
  ruling: v.string(),
  scope: v.string(),
});

type DemoTable = "transactions" | "glRows" | "staffAllocations" | "precedents";

async function clearTable(ctx: MutationCtx, table: DemoTable) {
  const rows = await ctx.db.query(table).collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

export const loadDemo = mutation({
  args: {
    passcode: v.optional(v.string()),
    transactions: v.array(txn),
    glRows: v.array(glRow),
    staffAllocations: v.array(staffAllocation),
    precedents: v.array(precedent),
  },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    await clearTable(ctx, "transactions");
    await clearTable(ctx, "glRows");
    await clearTable(ctx, "staffAllocations");
    await clearTable(ctx, "precedents");

    for (const row of args.transactions) {
      await ctx.db.insert("transactions", row);
    }
    for (const row of args.glRows) {
      await ctx.db.insert("glRows", row);
    }
    for (const row of args.staffAllocations) {
      await ctx.db.insert("staffAllocations", row);
    }
    for (const row of args.precedents) {
      await ctx.db.insert("precedents", row);
    }
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    if (settings) await ctx.db.patch(settings._id, { dataSource: "demo" });
    else {
      await ctx.db.insert("workspaceSettings", {
        key: "default",
        organizationName: "Valencia Youth Collective",
        approverName: "A. Okafor",
        approverTitle: "Executive Director",
        dataSource: "demo",
      });
    }
    await ctx.runMutation(internal.autonomy.enqueueAgentRun, {});
  },
});

function dedupeKey(t: { date: string; amountCents: number; description: string }) {
  return `${t.date}|${t.amountCents}|${t.description.trim().toUpperCase()}`;
}

export const appendBankTransactions = mutation({
  args: {
    passcode: v.optional(v.string()),
    transactions: v.array(txn),
    glRows: v.optional(v.array(glRow)),
  },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const existing = await ctx.db.query("transactions").collect();
    const keys = new Set(existing.map(dedupeKey));
    let maxNum = 0;
    for (const t of existing) {
      const n = parseInt(t.txnId.replace(/^T0*/, ""), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
    const added: { txnId: string; row: (typeof args.transactions)[number] }[] = [];
    for (const row of args.transactions) {
      if (keys.has(dedupeKey(row))) continue;
      maxNum += 1;
      const txnId = `T${String(maxNum).padStart(4, "0")}`;
      await ctx.db.insert("transactions", { ...row, txnId });
      added.push({ txnId, row });
      keys.add(dedupeKey(row));
    }
    for (const { txnId, row } of added) {
      const gl = (args.glRows ?? []).find(
        (r) =>
          r.date === row.date &&
          r.amountCents === row.amountCents &&
          r.description === row.description,
      );
      if (gl) await ctx.db.insert("glRows", { ...gl, bankRef: txnId });
    }
    const addedIds = added.map((a) => a.txnId);
    if (addedIds.length) {
      await ctx.runMutation(internal.autonomy.enqueueAgentRun, {
        journalLine: `Bank feed delivered ${addedIds.length} transaction${addedIds.length === 1 ? "" : "s"} — reviewing`,
      });
    }
    return { added: addedIds.length, txnIds: addedIds };
  },
});

export const resetRunState = mutation({
  args: { passcode: v.optional(v.string()) },
  handler: async (ctx, { passcode }) => {
    assertDemoPasscode(passcode);
    for (const row of await ctx.db.query("decisions").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("proposedEntries").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("inboxResolutions").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("runs").collect()) await ctx.db.delete(row._id);
    await ctx.db.insert("auditLog", {
      at: new Date().toISOString(),
      actor: "demo",
      action: "reset",
      targetId: "run",
      why: "Demo run state reset",
      evidence: [],
    });
  },
});

export const startCustomWorkspace = mutation({
  args: {
    passcode: v.optional(v.string()),
    transactions: v.array(txn),
    glRows: v.array(glRow),
    staffAllocations: v.array(staffAllocation),
    grantDocIds: v.array(v.id("grants")),
  },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const keep = new Set(args.grantDocIds.map(String));
    for (const row of await ctx.db.query("transactions").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("glRows").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("staffAllocations").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("decisions").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("proposedEntries").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("inboxResolutions").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("runs").collect()) await ctx.db.delete(row._id);
    for (const g of await ctx.db.query("grants").collect()) {
      if (!keep.has(String(g._id))) await ctx.db.delete(g._id);
    }
    for (const row of args.transactions) await ctx.db.insert("transactions", row);
    for (const row of args.glRows) await ctx.db.insert("glRows", row);
    for (const row of args.staffAllocations) await ctx.db.insert("staffAllocations", row);

    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    if (settings) {
      await ctx.db.patch(settings._id, { dataSource: "custom" });
    } else {
      await ctx.db.insert("workspaceSettings", {
        key: "default",
        organizationName: "Valencia Youth Collective",
        approverName: "A. Okafor",
        approverTitle: "Executive Director",
        dataSource: "custom",
      });
    }

    await ctx.db.insert("auditLog", {
      at: new Date().toISOString(),
      actor: "user",
      action: "new_workspace",
      targetId: "workspace",
      why: "Started custom data workspace",
      evidence: [`${args.transactions.length} bank txns`, `${args.grantDocIds.length} grants`],
    });
    await ctx.runMutation(internal.autonomy.enqueueAgentRun, {});
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const [transactions, glRows, staffAllocations, precedents] = await Promise.all([
      ctx.db.query("transactions").collect(),
      ctx.db.query("glRows").collect(),
      ctx.db.query("staffAllocations").collect(),
      ctx.db.query("precedents").collect(),
    ]);
    return {
      transactions: transactions.length,
      glRows: glRows.length,
      staffAllocations: staffAllocations.length,
      precedents: precedents.length,
    };
  },
});
