import { openapi } from "@orpc/openapi";

import { handleCliAuthApprovalPage } from "#server/cli-auth-page";
import type { Context } from "#server/context";
import { httpOutput } from "#server/http";
import { o } from "#server/procedures";

const approval = async (context: Context) =>
  httpOutput(
    await handleCliAuthApprovalPage({
      authenticate: context.authenticate,
      platform: context.platform,
      platformHeaders: context.platformHeaders,
      request: context.request,
      signInPath: context.cliAuthSignInPath,
    }),
    context
  );

export const cliAuthPageRouter = {
  get: o
    .meta(
      openapi({
        method: "GET",
        outputStructure: "detailed",
        path: "/cli-auth/approve",
      })
    )
    .handler(async ({ context }) => await approval(context)),
  post: o
    .meta(
      openapi({
        method: "POST",
        outputStructure: "detailed",
        path: "/cli-auth/approve",
        requestBodyHint: "octet-stream",
      })
    )
    .handler(async ({ context }) => await approval(context)),
};
