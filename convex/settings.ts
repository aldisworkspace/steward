import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { assertDemoPasscode } from "./passcode";

export const DEFAULTS = {
  organizationName: "Valencia Youth Collective",
  approverName: "A. Okafor",
  approverTitle: "Executive Director",
  dataSource: "demo" as const,
};

export async function getSettingsDoc(ctx: QueryCtx) {
  const row = await ctx.db
    .query("workspaceSettings")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .first();
  if (!row) return DEFAULTS;
  return {
    organizationName: row.organizationName,
    approverName: row.approverName,
    approverTitle: row.approverTitle,
    dataSource: row.dataSource,
  };
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const s = await getSettingsDoc(ctx);
    return {
      organizationName: s.organizationName,
      approverName: s.approverName,
      approverTitle: s.approverTitle,
      approverLabel: `${s.approverName} (${s.approverTitle})`,
      dataSource: s.dataSource,
    };
  },
});

export const update = mutation({
  args: {
    passcode: v.optional(v.string()),
    organizationName: v.optional(v.string()),
    approverName: v.optional(v.string()),
    approverTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const existing = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    const patch = {
      organizationName: args.organizationName ?? existing?.organizationName ?? DEFAULTS.organizationName,
      approverName: args.approverName ?? existing?.approverName ?? DEFAULTS.approverName,
      approverTitle: args.approverTitle ?? existing?.approverTitle ?? DEFAULTS.approverTitle,
      dataSource: existing?.dataSource ?? DEFAULTS.dataSource,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("workspaceSettings", { key: "default", ...patch });
  },
});
