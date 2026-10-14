import { openapi } from "@orpc/openapi";
import {
  eventIterator,
  ORPCError,
  streamToAsyncIteratorObject,
} from "@orpc/server";
import { appAgent } from "@tailorkit/agent/workflows";
import { issueAgentToken } from "@tailorkit/api-utils/agent-token";
import {
  asSchema,
  convertToModelMessages,
  createUIMessageStream,
  uiMessageChunkSchema,
  validateUIMessages,
} from "ai";
import type { UIMessageChunk } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import { authenticateCliRequest } from "#cli-token";
import { env } from "#env";
import { findAppInScopes, o, cliRouter } from "#procedures";
import { canonicalizeScope } from "#scope";

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const APP_AGENT_MODEL = "xiaomi/mimo-v2.6-pro";

const chunkSchema = asSchema(uiMessageChunkSchema);

/** Use the SDK's validator so transport parts stay aligned with its protocol. */
const agentChunkSchema = z
  .custom<UIMessageChunk>(async (value) => {
    const awaitedResult1 = await chunkSchema.validate?.(value);
    return awaitedResult1?.success === true;
  })
  .describe("An AI SDK UIMessageChunk. Fields depend on the chunk type.");

/** Parts stay extensible; the platform validates their SDK shapes before running. */
const agentMessagesSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      metadata: z.unknown().optional(),
      parts: z.array(z.looseObject({ type: z.string() })).min(1),
      role: z.enum(["user", "assistant"]),
    })
  )
  .min(1);

const agentChatSchema = z.object({
  appId: z.string().min(1),
  hostUrl: z.url({ protocol: /^https?$/u }),
  messages: agentMessagesSchema,
  schema: z.record(z.string(), z.unknown()).optional(),
});

const chat = cliRouter
  .meta(openapi({ method: "POST", outputStructure: "compact", path: "/chat" }))
  .input(
    z.object({
      body: agentChatSchema.extend({ deployToken: z.string().min(1) }),
    })
  )
  .output(eventIterator(agentChunkSchema))
  .handler(async ({ context, input, signal }) => {
    const token = await authenticateCliRequest(context, input.body.deployToken);
    const app = await findAppInScopes(context.project.id, input.body.appId, [
      canonicalizeScope(token.scope),
    ]);
    let messages;
    try {
      messages = await convertToModelMessages(
        await validateUIMessages({ messages: input.body.messages })
      );
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid agent messages.",
      });
    }
    // JWTs carry the same project/scope permissions as CLI sessions, not an app-only grant.
    // Reuse the credential across authorized app selections without extending its expiry.
    const run = await start(appAgent, [
      {
        agentToken:
          context.agentToken?.token ??
          (await issueAgentToken(
            {
              appId: app.id,
              cliTokenId: token.id,
              projectId: context.project.id,
              scope: token.scope,
            },
            require(env.AUTH_SECRET),
            env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform"
          )),
        appId: app.id,
        hostUrl: input.body.hostUrl,
        messages,
        model: APP_AGENT_MODEL,
        schema: input.body.schema,
      },
    ]);
    return streamToAsyncIteratorObject(
      createUIMessageStream({
        execute: async ({ writer }) => {
          const controller = new AbortController();
          writer.merge(
            run
              .getReadable<UIMessageChunk>()
              .pipeThrough(
                new TransformStream<UIMessageChunk, UIMessageChunk>(),
                {
                  signal: controller.signal,
                }
              )
          );
          try {
            // Finish the response only after cleanup releases the app's Drive.
            await run.returnValue;
          } catch (error) {
            // A busy Drive can fail before the workflow opens its model stream.
            controller.abort(error);
            throw error;
          }
        },
        onError: (error) =>
          error instanceof Error ? error.message : String(error),
      }),
      { signal }
    );
  });

export const appAgentRouter = o
  .meta(openapi({ prefix: "/app-agent" }))
  .router({ chat });
