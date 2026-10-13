import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";

import { action } from "./functions";

declare module "../client" {
  interface TailorKitServerTools {
    billing: { read: (input: { accountId: string }) => Promise<number> };
  }
}
action({
  args: z.object({ accountId: z.string() }),

  handler: async (ctx) => {
    expectTypeOf(ctx.tools.billing.read(ctx.args)).toEqualTypeOf<
      Promise<number>
    >();
    expectTypeOf(ctx.identity.subjectId).toEqualTypeOf<string | undefined>();
    return await ctx.tools.billing.read(ctx.args);
  },
});
