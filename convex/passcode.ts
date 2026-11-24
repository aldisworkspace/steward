import { ConvexError } from "convex/values";

/** Compare without an early exit, so response time doesn't reveal how much of the key matched. */
export function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function assertDemoPasscode(passcode: string | undefined) {
  const expected = process.env.DEMO_PASSCODE;
  if (!expected) return;
  if (!passcode || !sameSecret(passcode, expected)) {
    throw new ConvexError("Invalid or missing demo passcode.");
  }
}
