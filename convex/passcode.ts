import { ConvexError } from "convex/values";

export function assertDemoPasscode(passcode: string | undefined) {
  const expected = process.env.DEMO_PASSCODE;
  if (!expected) return;
  if (passcode !== expected) {
    throw new ConvexError("Invalid or missing demo passcode.");
  }
}
