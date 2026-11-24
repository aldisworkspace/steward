/**
 * Pilot requests from the public landing page. Public (no demo key): contact details only, length-limited,
 * one request per email per day and a daily cap overall, so the form can't be used to flood the table.
 * Never accepts files or financial data.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, mutation } from "./_generated/server";

export const PILOT_LIMITS = { name: 120, organization: 160, email: 254, system: 60, note: 1000, perDay: 200 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY_MS = 86_400_000;

export const request = mutation({
  args: {
    name: v.string(),
    organization: v.string(),
    email: v.string(),
    system: v.string(),
    note: v.string(),
    /** Honeypot: a hidden field people never fill. */
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Bots fill every field: accept silently, store nothing.
    if (args.website?.trim()) return { ok: true };
    const clean = {
      name: args.name.trim(),
      organization: args.organization.trim(),
      email: args.email.trim().toLowerCase(),
      system: args.system.trim(),
      note: args.note.trim(),
    };
    if (!clean.name || !clean.organization || !clean.email) throw new ConvexError("Name, organization and work email are required.");
    if (!EMAIL.test(clean.email)) throw new ConvexError("That email address doesn't look right.");
    for (const k of ["name", "organization", "email", "system", "note"] as const) {
      if (clean[k].length > PILOT_LIMITS[k]) throw new ConvexError(`The ${k} field is too long.`);
    }
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const same = await ctx.db.query("pilotRequests").withIndex("by_email", (q) => q.eq("email", clean.email)).collect();
    if (same.some((r) => r.createdAt >= since)) return { ok: true, duplicate: true };
    const recent = await ctx.db.query("pilotRequests").order("desc").take(PILOT_LIMITS.perDay);
    if (recent.length >= PILOT_LIMITS.perDay && recent[recent.length - 1]!.createdAt >= since) {
      throw new ConvexError("We're getting a lot of requests right now. Please try again tomorrow.");
    }
    const requestId = await ctx.db.insert("pilotRequests", { ...clean, createdAt: new Date().toISOString() });
    // Email the owner (no-op until RESEND_API_KEY and PILOT_NOTIFY_TO are set); the request is stored either way.
    await ctx.scheduler.runAfter(0, internal.pilotNotify.notify, { requestId });
    return { ok: true };
  },
});

export const get = internalQuery({
  args: { requestId: v.id("pilotRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    return r && { name: r.name, organization: r.organization, email: r.email, system: r.system, note: r.note, createdAt: r.createdAt };
  },
});
