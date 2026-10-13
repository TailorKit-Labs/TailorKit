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
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  handler: async (ctx) => {
    expectTypeOf(ctx.tools.billing.read(ctx.args)).toEqualTypeOf<
      Promise<number>
    >();
    expectTypeOf(ctx.identity.subjectId).toEqualTypeOf<string | undefined>();
    return ctx.tools.billing.read(ctx.args);
  },
});
