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
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    passcode: v.optional(v.string()),
    source: v.optional(v.union(v.literal("demo"), v.literal("upload"))),
  },
  handler: async (ctx, { storageId, fileName, passcode, source }) => {
    assertDemoPasscode(passcode);
    const src = source ?? "upload";
    const existing = await ctx.db
      .query("grants")
      .withIndex("by_fileName", (q) => q.eq("fileName", fileName))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { storageId, status: "uploaded", error: undefined, source: src });
      return existing._id;
    }
    return await ctx.db.insert("grants", {
      storageId,
      fileName,
      terms: null,
      status: "uploaded",
      source: src,
    });
  },
});

export const confirmGrantTerms = mutation({
  args: {
    grantDocId: v.id("grants"),
    terms: v.any(),
    passcode: v.optional(v.string()),
  },
  handler: async (ctx, { grantDocId, terms, passcode }) => {
    assertDemoPasscode(passcode);
    const t = terms as { grantId: string };
    await ctx.db.patch(grantDocId, {
      status: "ready",
      terms,
      grantId: t.grantId,
      error: undefined,
    });
    await ctx.db.insert("auditLog", {
      at: new Date().toISOString(),
      actor: "user",
      action: "confirm_grant_terms",
      targetId: t.grantId,
      why: "User confirmed extracted grant terms",
      evidence: [],
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
      source: g.source ?? "demo",
      error: g.error,
      budgetLineCount:
        g.terms && typeof g.terms === "object" && g.terms !== null && "budgetLines" in g.terms
          ? (g.terms as { budgetLines: unknown[] }).budgetLines.length
          : 0,
    }));
  },
});

export const listFull = query({
  args: {},
  handler: async (ctx) => {
    const grants = await ctx.db.query("grants").collect();
    return grants.map((g) => ({
      _id: g._id,
      fileName: g.fileName,
      grantId: g.grantId,
      status: g.status,
      source: g.source,
      terms: g.terms,
      error: g.error,
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
