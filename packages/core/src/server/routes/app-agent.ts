import { eventIterator, ORPCError } from "@orpc/server";
import {
  agentChatSchema,
  agentChunkSchema,
  agentRunCompleteChunkSchema,
} from "@tailorkit/client-platform/agent";
import { appAgentChat } from "@tailorkit/client-platform/client";

import {
  getCliDeployToken,
  o,
  requireCliDeployToken,
} from "#server/procedures";

/** CLI calls the host; only the host supplies the platform project credential. */
export const appAgentRouter = {
  chat: o
    .use(requireCliDeployToken)
    .input(agentChatSchema)
    .output(eventIterator(agentChunkSchema))
    .handler(async function* chat({ context, input, signal: clientSignal }) {
      const controller = new AbortController();
      const signal = clientSignal
        ? AbortSignal.any([clientSignal, controller.signal])
        : controller.signal;
      try {
        let streamError: unknown;
        let done = false;
        const { stream } = await appAgentChat({
          body: { ...input, deployToken: getCliDeployToken(context.request) },

          client: context.platform,

          headers: context.platformHeaders,

          onSseError: (error) => {
            streamError = error;
          },

          signal,

          // Only the CLI can reconnect with the signed identity and exact cursor.
          sseMaxRetryAttempts: 1,
        });
        for await (const value of stream) {
          const event = await agentChunkSchema.parseAsync(value);
          if (
            event.type === "finish" ||
            event.type === "error" ||
            agentRunCompleteChunkSchema.safeParse(event).success
          ) {
            done = true;
          }
          yield event;
        }
        signal?.throwIfAborted();
        if (
          streamError !== undefined &&
          streamError !== null &&
          streamError !== false &&
          streamError !== "" &&
          streamError !== 0 &&
          !Number.isNaN(streamError) &&
          streamError !== 0n
        ) {
          throw new ORPCError("BAD_GATEWAY", {
            message: "The app agent stream failed. Try again.",
          });
        }
        if (!done) {
          throw new ORPCError("BAD_GATEWAY", {
            message: "The agent stream ended unexpectedly. Try again.",
          });
        }
      } finally {
        // Iterator cancellation must also terminate the upstream HTTP stream.
        controller.abort();
      }
    }),
};
