"use node";
/**
 * Email the owner about each pilot request (Resend HTTP API). Configured only by env vars, so no address or key
 * lives in this public repo:
 *   RESEND_API_KEY   — set by the owner in the Convex dashboard / CLI (never committed)
 *   PILOT_NOTIFY_TO  — recipient address
 * Without either, nothing is sent and the request is still stored in pilotRequests.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type Req = { name: string; organization: string; email: string; system: string; note: string; createdAt: string };

async function send(subject: string, text: string): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.PILOT_NOTIFY_TO;
  if (!key || !to) return { sent: false, reason: "RESEND_API_KEY or PILOT_NOTIFY_TO is not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Steward <onboarding@resend.dev>", to: [to], subject, text }),
  });
  if (!res.ok) return { sent: false, reason: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { sent: true };
}

export function pilotEmail(r: Req) {
  const subject = `Steward pilot request: ${r.organization}`.slice(0, 150);
  const text = [
    "New pilot request from steward.nur.capital",
    "",
    `Name:         ${r.name}`,
    `Organization: ${r.organization}`,
    `Email:        ${r.email}`,
    `System:       ${r.system || "-"}`,
    `Received:     ${r.createdAt}`,
    "",
    "Note:",
    r.note || "-",
    "",
    "Reply to them directly. Ask for files only through a private workspace, never by email.",
  ].join("\n");
  return { subject, text };
}

export const notify = internalAction({
  args: { requestId: v.id("pilotRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.runQuery(internal.pilot.get, { requestId });
    if (!r) return { sent: false, reason: "request not found" };
    const { subject, text } = pilotEmail(r);
    const result = await send(subject, text);
    if (!result.sent) console.warn(`Pilot request ${requestId} stored but not emailed: ${result.reason}`);
    return result;
  },
});

/** `npx convex run --prod pilotNotify:sendTest` — checks the setup without storing a request. */
export const sendTest = internalAction({
  args: {},
  handler: async () =>
    send("Steward pilot request: test", "Test from Steward: pilot request emails are set up. No request was stored."),
});
