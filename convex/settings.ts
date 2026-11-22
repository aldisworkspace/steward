import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { assertDemoPasscode } from "./passcode";

export const DEFAULTS = {
  organizationName: "Valencia Youth Collective",
  approverName: "A. Okafor",
  approverTitle: "Executive Director",
  dataSource: "demo" as const,
  receiptThresholdCents: 75_00,
};

/** Fictional default role holders; editable in settings. Name-based until real auth. */
export const DEFAULT_ROLES = {
  preparers: ["J. Rivera (Staff Accountant)"],
  programApprovers: ["M. Chen (Program Director)"],
};

export async function getSettingsDoc(ctx: QueryCtx) {
  const row = await ctx.db
    .query("workspaceSettings")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .first();
  if (!row) return { ...DEFAULTS, ...rolesFor(DEFAULTS) };
  return {
    organizationName: row.organizationName,
    approverName: row.approverName,
    approverTitle: row.approverTitle,
    dataSource: row.dataSource,
    receiptThresholdCents: row.receiptThresholdCents ?? DEFAULTS.receiptThresholdCents,
    ...rolesFor(row),
  };
}

function rolesFor(row: { approverName: string; approverTitle: string; programApprovers?: string[]; preparers?: string[]; reviewers?: string[] }) {
  const primary = `${row.approverName} (${row.approverTitle})`;
  return {
    preparers: row.preparers ?? DEFAULT_ROLES.preparers,
    reviewers: row.reviewers ?? [primary, "Controller"],
    programApprovers: row.programApprovers ?? [...DEFAULT_ROLES.programApprovers, primary],
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
      receiptThresholdCents: s.receiptThresholdCents,
      preparers: s.preparers,
      reviewers: s.reviewers,
      programApprovers: s.programApprovers,
    };
  },
});

export const update = mutation({
  args: {
    passcode: v.optional(v.string()),
    organizationName: v.optional(v.string()),
    approverName: v.optional(v.string()),
    approverTitle: v.optional(v.string()),
    receiptThresholdCents: v.optional(v.number()),
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
      receiptThresholdCents: args.receiptThresholdCents ?? existing?.receiptThresholdCents ?? DEFAULTS.receiptThresholdCents,
    };
    if (!Number.isInteger(patch.receiptThresholdCents) || patch.receiptThresholdCents < 0) {
      throw new Error("receiptThresholdCents must be a non-negative integer (cents).");
    }
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("workspaceSettings", { key: "default", ...patch });
  },
});
