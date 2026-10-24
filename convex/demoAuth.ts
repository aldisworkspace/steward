import { query } from "./_generated/server";

export const gate = query({
  args: {},
  handler: async () => ({
    requiresPasscode: !!process.env.DEMO_PASSCODE,
  }),
});
