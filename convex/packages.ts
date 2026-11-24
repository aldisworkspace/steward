/**
 * Billing packages (invoice + expenditure report) per grant × billing period.
 * Flow: draft → ready_for_review (preparer) → signed (reviewer, all tie-out checks pass) → exported.
 * Steward builds the numbers; only people prepare and sign, and preparer ≠ reviewer on a package.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertDemoPasscode } from "./passcode";
import { assertRole } from "./approverGuard";
import { getSettingsDoc } from "./settings";
import {
  billingPeriods, buildPackage, withGlClaims, defaultInvoiceNo, type BillingPackage, type PriorPackage, type Resolution,
  type TieOutDecision,
} from "../lib/tieOut";
import type { GrantTerms, Txn } from "../lib/types";

async function loadInputs(ctx: QueryCtx) {
  const [grantRows, txns, decisions, receipts, resolutions, packages, settings, glRows] = await Promise.all([
    ctx.db.query("grants").collect(),
    ctx.db.query("transactions").collect(),
    ctx.db.query("decisions").collect(),
    ctx.db.query("receipts").collect(),
    ctx.db.query("inboxResolutions").collect(),
    ctx.db.query("packages").collect(),
    getSettingsDoc(ctx),
    ctx.db.query("glRows").collect(),
  ]);
  const grants = grantRows.filter((g) => g.status === "ready" && g.terms).map((g) => g.terms as GrantTerms);
  return { grants, txns: withGlClaims(txns as unknown as Txn[], glRows), decisions, receipts, resolutions, packages, settings };
}
type Inputs = Awaited<ReturnType<typeof loadInputs>>;

function build(inp: Inputs, grant: GrantTerms, periodStart: string, periodEnd: string): BillingPackage {
  const priorPackages: PriorPackage[] = inp.packages
    .filter((p) => p.grantId === grant.grantId && p.snapshot && p.periodStart !== periodStart)
    .map((p) => ({ periodStart: p.periodStart, periodEnd: p.periodEnd, status: p.status, totalsByBudgetLine: (p.snapshot as BillingPackage).totalsByBudgetLine }));
  return buildPackage({
    grant, periodStart, periodEnd, lines: inp.txns,
    decisions: inp.decisions.map((d) => ({
      txnId: d.txnId, grantId: d.grantId, budgetLine: d.budgetLine, splits: d.splits as TieOutDecision["splits"],
      status: d.status, ruleHits: d.ruleHits, checks: d.checks as TieOutDecision["checks"], rationale: d.rationale,
    })),
    receipts: inp.receipts.filter((r) => r.status === "ready").map((r) => ({ receiptId: String(r._id), fileName: r.fileName, matchedTxnId: r.matchedTxnId })),
    resolutions: inp.resolutions.map((r) => ({ txnId: r.txnId, resolution: r.resolution as Resolution, by: r.by })),
    priorPackages,
    receiptThresholdCents: inp.settings.receiptThresholdCents,
  });
}

const frozen = (p: Doc<"packages"> | undefined) => !!p && (p.status === "signed" || p.status === "exported");

function summary(grant: GrantTerms, periodStart: string, periodEnd: string, row: Doc<"packages"> | undefined, pkg: BillingPackage) {
  return {
    grantId: grant.grantId, program: grant.program, funder: grant.funder, periodStart, periodEnd,
    packageId: row?._id ?? null, status: row?.status ?? ("draft" as const), invoiceNo: row?.invoiceNo ?? defaultInvoiceNo(grant.grantId, periodStart),
    preparedBy: row?.preparedBy ?? null, reviewedBy: row?.reviewedBy ?? null, signedAt: row?.signedAt ?? null,
    invoiceTotalCents: pkg.invoiceTotalCents, lineCount: pkg.lines.length, excludedCount: pkg.excluded.length,
    checksPassed: pkg.checks.filter((c) => c.pass).length, checksTotal: pkg.checks.length,
    failing: pkg.checks.filter((c) => !c.pass).map((c) => c.id),
    frequency: grant.billing?.frequency ?? "none",
    dueDate: packageDueDate(grant, periodEnd),
  };
}

/** When the funder expects this package: period end + invoice terms, else the report due date. Display only. */
function packageDueDate(grant: GrantTerms, periodEnd: string): string | null {
  const days = grant.billing?.invoiceDueDays;
  if (days != null && (grant.billing?.frequency ?? "none") !== "none") {
    const [y, m, d] = periodEnd.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
  }
  return grant.reportDue ?? null;
}

/** Every grant × billing period, derived from the terms and the data (live numbers unless signed). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const inp = await loadInputs(ctx);
    const glDates = inp.txns.filter((t) => t.source !== "bank").map((t) => t.date).sort();
    const last = glDates[glDates.length - 1] ?? null;
    const out = [];
    for (const grant of inp.grants) {
      for (const { periodStart, periodEnd } of billingPeriods(grant, last)) {
        const row = inp.packages.find((p) => p.grantId === grant.grantId && p.periodStart === periodStart);
        const pkg = frozen(row) ? (row!.snapshot as BillingPackage) : build(inp, grant, periodStart, periodEnd);
        out.push(summary(grant, periodStart, periodEnd, row, pkg));
      }
    }
    return out;
  },
});

export const get = query({
  args: { grantId: v.string(), periodStart: v.string(), periodEnd: v.string() },
  handler: async (ctx, { grantId, periodStart, periodEnd }) => {
    const inp = await loadInputs(ctx);
    const grant = inp.grants.find((g) => g.grantId === grantId);
    if (!grant) return null;
    const row = inp.packages.find((p) => p.grantId === grantId && p.periodStart === periodStart);
    const pkg = frozen(row) ? (row!.snapshot as BillingPackage) : build(inp, grant, periodStart, periodEnd);
    return { ...summary(grant, periodStart, periodEnd, row, pkg), package: pkg, live: !frozen(row) };
  },
});

/** For the CSV export: the signed snapshot plus what the report header needs. */
export const getSigned = query({
  args: { packageId: v.id("packages") },
  handler: async (ctx, { packageId }) => {
    const row = await ctx.db.get(packageId);
    if (!row || !frozen(row) || !row.snapshot) return null;
    const settings = await getSettingsDoc(ctx);
    const grants = await ctx.db.query("grants").withIndex("by_grantId", (q) => q.eq("grantId", row.grantId)).collect();
    const terms = grants.find((g) => g.terms)?.terms as GrantTerms | undefined;
    return {
      snapshot: row.snapshot as BillingPackage, invoiceNo: row.invoiceNo, status: row.status, preparedBy: row.preparedBy,
      reviewedBy: row.reviewedBy, signedAt: row.signedAt, organization: settings.organizationName,
      funder: terms?.funder ?? "", program: terms?.program ?? "",
    };
  },
});

async function audit(ctx: MutationCtx, actor: string, action: string, targetId: string, why: string, evidence: string[] = []) {
  await ctx.db.insert("auditLog", { at: new Date().toISOString(), actor, action, targetId, why, evidence });
}

/** Preparer submits the package for review. Creates the row on first use. */
export const markReady = mutation({
  args: { grantId: v.string(), periodStart: v.string(), periodEnd: v.string(), by: v.string(), invoiceNo: v.optional(v.string()), passcode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const by = await assertRole(ctx, args.by, "preparer");
    const inp = await loadInputs(ctx);
    const grant = inp.grants.find((g) => g.grantId === args.grantId);
    if (!grant) throw new ConvexError(`Grant ${args.grantId} is not ready`);
    if (!billingPeriods(grant, args.periodEnd).some((p) => p.periodStart === args.periodStart && p.periodEnd === args.periodEnd)) {
      throw new ConvexError(`${args.periodStart}–${args.periodEnd} is not a billing period of ${args.grantId}`);
    }
    const row = inp.packages.find((p) => p.grantId === args.grantId && p.periodStart === args.periodStart);
    if (frozen(row)) throw new ConvexError(`Package is already ${row!.status}; reopen it first.`);
    const pkg = build(inp, grant, args.periodStart, args.periodEnd);
    const invoiceNo = args.invoiceNo?.trim() || row?.invoiceNo || defaultInvoiceNo(args.grantId, args.periodStart);
    let id: Id<"packages">;
    if (row) {
      id = row._id;
      await ctx.db.patch(row._id, { status: "ready_for_review", preparedBy: by, invoiceNo });
    } else {
      id = await ctx.db.insert("packages", {
        grantId: args.grantId, periodStart: args.periodStart, periodEnd: args.periodEnd, invoiceNo,
        status: "ready_for_review", preparedBy: by, reviewedBy: null, snapshot: null, createdAt: new Date().toISOString(), signedAt: null,
      });
    }
    const failing = pkg.checks.filter((c) => !c.pass).map((c) => c.id);
    await audit(ctx, by, "package_ready", String(id), `${invoiceNo} ready for review (${pkg.invoiceTotalCents} cents)`,
      failing.length ? [`failing: ${failing.join(", ")}`] : ["all checks pass"]);
    return id;
  },
});

/** Reviewer signs. Blocked unless every tie-out check passes; the reviewer must not be the preparer. */
export const sign = mutation({
  args: { packageId: v.id("packages"), by: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const by = await assertRole(ctx, args.by, "reviewer");
    const row = await ctx.db.get(args.packageId);
    if (!row) throw new ConvexError("Package not found");
    if (row.status !== "ready_for_review") throw new ConvexError(`Package is ${row.status}; only a package ready for review can be signed.`);
    if (row.preparedBy && row.preparedBy.trim() === by) {
      throw new ConvexError("Segregation of duties: the preparer of a package cannot sign it.");
    }
    const inp = await loadInputs(ctx);
    const grant = inp.grants.find((g) => g.grantId === row.grantId);
    if (!grant) throw new ConvexError(`Grant ${row.grantId} is not ready`);
    const pkg = build(inp, grant, row.periodStart, row.periodEnd);
    const failing = pkg.checks.filter((c) => !c.pass);
    if (failing.length) {
      throw new ConvexError(`Cannot sign: ${failing.map((c) => `${c.id} (${c.detail})`).join("; ")}`);
    }
    const at = new Date().toISOString();
    await ctx.db.patch(row._id, { status: "signed", reviewedBy: by, snapshot: pkg, signedAt: at });
    await audit(ctx, by, "package_signed", String(row._id), `${row.invoiceNo} signed at ${pkg.invoiceTotalCents} cents`, [`prepared by ${row.preparedBy ?? "?"}`]);
  },
});

/** Reopen a submitted or signed package for correction. Logged with the reason; the snapshot is discarded. */
export const reopen = mutation({
  args: { packageId: v.id("packages"), by: v.string(), reason: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const row = await ctx.db.get(args.packageId);
    if (!row) throw new ConvexError("Package not found");
    let by: string;
    try { by = await assertRole(ctx, args.by, "reviewer"); } catch { by = await assertRole(ctx, args.by, "preparer"); }
    if (!args.reason.trim()) throw new ConvexError("Say why the package is reopened.");
    if (row.status === "draft") throw new ConvexError("Package is already a draft.");
    const previous = row.status;
    await ctx.db.patch(row._id, { status: "draft", reviewedBy: null, snapshot: null, signedAt: null });
    await audit(ctx, by, "package_reopened", String(row._id), args.reason.trim(), [`was ${previous}`, row.invoiceNo]);
  },
});

export const markExported = mutation({
  args: { packageId: v.id("packages"), by: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertDemoPasscode(args.passcode);
    const row = await ctx.db.get(args.packageId);
    if (!row) throw new ConvexError("Package not found");
    let by: string;
    try { by = await assertRole(ctx, args.by, "reviewer"); } catch { by = await assertRole(ctx, args.by, "preparer"); }
    if (row.status !== "signed" && row.status !== "exported") throw new ConvexError("Only a signed package can be exported.");
    await ctx.db.patch(row._id, { status: "exported" });
    await audit(ctx, by, "package_exported", String(row._id), `${row.invoiceNo} exported`);
  },
});
