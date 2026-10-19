import { ORPCError } from "@orpc/server";
import {
  cliAuthApprove,
  cliAuthDeny,
  cliAuthPoll,
  cliAuthStart,
} from "@patchsmith/client-platform/client";
import * as v from "valibot";

import {
  getPatchSmithScope,
  o,
  requireCliDeployToken,
  requireHostAuth,
} from "#server/procedures";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const runPlatformCliAuthRequest = async <T>(
  request: Promise<T>
): Promise<T> => {
  try {
    return await request;
  } catch (error) {
    if (isStringValue(error) && error.toLowerCase() === "unauthorized") {
      throw new ORPCError("UNAUTHORIZED", {
        message:
          "PatchSmith platform rejected the host project key. Check PATCHSMITH_PROJECT_KEY.",
      });
    }

    throw error;
  }
};

export const cliAuthRouter = {
  approve: o
    .use(requireHostAuth)
    .input(
      v.object({
        scope: v.pipe(v.string(), v.minLength(1)),
        userCode: v.pipe(v.string(), v.minLength(1)),
      })
    )
    .handler(
      async ({ context, input }) =>
        await runPlatformCliAuthRequest(
          cliAuthApprove({
            body: {
              scope: getPatchSmithScope(context, input.scope),
              userCode: input.userCode,
            },
            client: context.platform,
            headers: context.platformHeaders,
          })
        )
    ),
  deny: o
    .use(requireHostAuth)
    .input(v.object({ userCode: v.pipe(v.string(), v.minLength(1)) }))
    .handler(
      async ({ context, input }) =>
        await runPlatformCliAuthRequest(
          cliAuthDeny({
            body: {
              userCode: input.userCode,
            },
            client: context.platform,
            headers: context.platformHeaders,
          })
        )
    ),
  poll: o
    .input(v.object({ deviceCode: v.pipe(v.string(), v.minLength(1)) }))
    .handler(
      async ({ context, input }) =>
        await runPlatformCliAuthRequest(
          cliAuthPoll({
            body: {
              deviceCode: input.deviceCode,
            },
            client: context.platform,
            headers: context.platformHeaders,
          })
        )
    ),
  start: o.input(v.object({})).handler(
    async ({ context }) =>
      await runPlatformCliAuthRequest(
        cliAuthStart({
          body: {},
          client: context.platform,
          headers: context.platformHeaders,
        })
      )
  ),
  verifyToken: o
    .input(v.object({}))
    .use(requireCliDeployToken)
    .handler(({ context }) => ({ scope: getPatchSmithScope(context) })),
};
