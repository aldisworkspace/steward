import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { getSettingsDoc } from "./settings";

const CONTROLLER = "Controller";

export type Role = "preparer" | "reviewer" | "program_approver";

/**
 * Name-based role check. There is no real authentication yet (a later phase): `by` is the name the
 * person picked, checked against the role lists in workspaceSettings. Steward can never hold a role.
 */
export async function assertRole(ctx: MutationCtx, by: string, role: Role): Promise<string> {
  const who = by.trim();
  if (!who) throw new ConvexError("Name required.");
  if (/steward/i.test(who)) {
    throw new ConvexError("Segregation of duties: Steward prepares drafts but cannot approve, prepare or sign for a person.");
  }
  const s = await getSettingsDoc(ctx);
  const list = role === "preparer" ? s.preparers : role === "reviewer" ? s.reviewers : s.programApprovers;
  if (!list.includes(who)) {
    throw new ConvexError(`Unknown ${role.replace("_", " ")}: ${who}`);
  }
  return who;
}

/**
 * Program sign-off on a GL line: a program approver, and not the person who entered that GL line.
 * Name-based until real auth.
 */
export async function assertProgramApprover(ctx: MutationCtx, by: string, txnId: string): Promise<string> {
  const who = await assertRole(ctx, by, "program_approver");
  const gl = await ctx.db.query("glRows").withIndex("by_bankRef", (q) => q.eq("bankRef", txnId)).first();
  if (gl && gl.enteredBy.trim() === who) {
    throw new ConvexError(`Segregation of duties: ${who} entered ${txnId} and cannot approve it for the program.`);
  }
  return who;
}

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
