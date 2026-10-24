import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertDemoPasscode } from "./passcode";

export const generateUploadUrl = mutation({
  args: { passcode: v.optional(v.string()) },
  handler: async (ctx, { passcode }) => {
    assertDemoPasscode(passcode);
    return ctx.storage.generateUploadUrl();
  },
});

export const registerGrant = mutation({
  args: { storageId: v.id("_storage"), fileName: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { storageId, fileName, passcode }) => {
    assertDemoPasscode(passcode);
    const existing = await ctx.db
      .query("grants")
      .withIndex("by_fileName", (q) => q.eq("fileName", fileName))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { storageId, status: "uploaded", error: undefined });
      return existing._id;
    }
    return await ctx.db.insert("grants", {
      storageId,
      fileName,
      terms: null,
      status: "uploaded",
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const grants = await ctx.db.query("grants").collect();
    return grants.map((g) => ({
      _id: g._id,
      fileName: g.fileName,
      grantId: g.grantId ?? (g.terms as { grantId?: string } | null)?.grantId ?? null,
      status: g.status,
      error: g.error,
      budgetLineCount:
        g.terms && typeof g.terms === "object" && g.terms !== null && "budgetLines" in g.terms
          ? (g.terms as { budgetLines: unknown[] }).budgetLines.length
          : 0,
    }));
  },
});

export const getByFileName = query({
  args: { fileName: v.string() },
  handler: async (ctx, { fileName }) =>
    ctx.db.query("grants").withIndex("by_fileName", (q) => q.eq("fileName", fileName)).first(),
});

/** Clear error state so extractGrant can retry (PDF already in storage). */
export const resetExtractErrors = mutation({
  args: { passcode: v.optional(v.string()) },
  handler: async (ctx, { passcode }) => {
    assertDemoPasscode(passcode);
    const grants = await ctx.db.query("grants").collect();
    let n = 0;
    for (const g of grants) {
      if (g.status === "error") {
        await ctx.db.patch(g._id, { status: "uploaded", error: undefined });
        n += 1;
      }
    }
    return { reset: n };
  },
});
