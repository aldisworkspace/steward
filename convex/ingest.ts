import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
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
