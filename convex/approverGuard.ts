import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { getSettingsDoc } from "./settings";

const CONTROLLER = "Controller";

export async function assertHumanApprover(ctx: MutationCtx, by: string, txnId: string) {
  const who = by.trim();
  if (/steward/i.test(who)) {
    throw new ConvexError(
      "Segregation of duties: Steward proposes entries but cannot approve or reject them.",
    );
  }
  const settings = await getSettingsDoc(ctx);
  const primary = `${settings.approverName} (${settings.approverTitle})`;
  if (who !== primary && who !== CONTROLLER) {
    throw new ConvexError(`Unknown approver: ${who}`);
  }
  const gl = await ctx.db
    .query("glRows")
    .withIndex("by_bankRef", (q) => q.eq("bankRef", txnId))
    .first();
  if (gl && gl.enteredBy.trim() === who) {
    throw new ConvexError("Segregation of duties: cannot approve or reject your own GL entry.");
  }
}
