import { ORPCError } from "@orpc/server";
import { previewStart, previewStop } from "@tailorkit/client-platform/client";
import { ACTIVE_PREVIEW_CONFLICT_REASON } from "@tailorkit/client-platform/preview";
import { z } from "zod";

import {
  getCliDeployToken,
  o,
  requireCliDeployToken,
} from "#server/procedures";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

export const isActivePreviewConflict = (cause: unknown): boolean => {
  if (!isObjectValue(cause)) {
    return false;
  }

  if (
    "data" in cause &&
    isObjectValue(cause.data) &&
    "reason" in cause.data &&
    cause.data.reason === ACTIVE_PREVIEW_CONFLICT_REASON
  ) {
    return true;
  }

  // Older platform versions do not return a structured reason. Keep their message format working.
  const message =
    "message" in cause && isStringValue(cause.message) ? cause.message : "";
  if (
    /active preview already exists|preview is already running/iu.test(message)
  ) {
    return true;
  }

  return (
    ("error" in cause && isActivePreviewConflict(cause.error)) ||
    ("cause" in cause && isActivePreviewConflict(cause.cause))
  );
};

/** Host route used by the CLI to start a scope-authorized preview session. */
export const previewRouter = {
  start: o
    .use(requireCliDeployToken)
    .input(
      z.object({
        appId: z.string().min(1),
        replaceActive: z.boolean().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      try {
        return await previewStart({
          body: {
            appId: input.appId,
            deployToken: getCliDeployToken(context.request),
            replaceActive: input.replaceActive,
          },
          client: context.platform,
          headers: context.platformHeaders,
        });
      } catch (error) {
        if (isActivePreviewConflict(error)) {
          throw new ORPCError("CONFLICT", {
            message:
              "A preview is already running for this app. Run `pnpm tailorkit preview --replace` to end it and start a new one.",
          });
        }
        throw error;
      }
    }),
  /** Host route used by the CLI to end a preview session it started. */
  stop: o
    .use(requireCliDeployToken)
    .input(z.object({ sessionId: z.uuid() }))
    .handler(
      async ({ context, input }) =>
        await previewStop({
          body: { deployToken: getCliDeployToken(context.request) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { sessionId: input.sessionId },
        })
    ),
};
