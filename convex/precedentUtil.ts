import type { MutationCtx } from "./_generated/server";
import type { RulingType } from "../lib/types";
import { vendorKey } from "../lib/vendorKey";

export async function insertTypedPrecedent(
  ctx: MutationCtx,
  args: {
    date: string;
    by: string;
    scope: string;
    rulingType: RulingType;
    note: string;
    txnId?: string;
    vendorScope?: boolean;
    description?: string;
  },
) {
  const rows = await ctx.db.query("precedents").collect();
  const id = `P${rows.length + 1}`;
  await ctx.db.insert("precedents", {
    date: args.date,
    by: args.by,
    scope: args.scope,
    ruling: args.note,
    rulingType: args.rulingType,
    note: args.note,
    matchTxnId: args.vendorScope ? undefined : args.txnId,
    matchVendorKey: args.vendorScope && args.description ? vendorKey(args.description) : undefined,
  });
  await ctx.db.insert("auditLog", {
    at: new Date().toISOString(),
    actor: args.by,
    action: "precedent_recorded",
    targetId: id,
    why: args.note,
    evidence: [args.rulingType, args.scope],
  });
  return id;
}
