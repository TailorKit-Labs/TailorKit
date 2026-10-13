import { runAgentTUI } from "@ai-sdk/tui";
import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import type { ChatTransport, UIMessage } from "ai";

import { fetchSchemaFromHost, readSchemaFile } from "./generator/types";
import type { TailorKitSchemaFile } from "./generator/types";

const schemaFetchTimeoutMs = 10_000;

interface AgentTuiOptions {
  client: Pick<TailorKitRouterClient, "appAgent">;
  hostUrl: string;
  appId: string;
  schemaPath?: string;
}

export const openAgentTui = async ({
  client,
  hostUrl,
  appId,
  schemaPath,
}: AgentTuiOptions) => {
  const transport: ChatTransport<UIMessage> = {
    reconnectToStream() {
      return Promise.resolve(null);
    },
    async sendMessages({ messages, abortSignal }) {
      const timeoutSignal = AbortSignal.timeout(schemaFetchTimeoutMs);
      const schemaSignal = abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal;
      let schema: TailorKitSchemaFile;
      try {
        schemaSignal.throwIfAborted();
        schema =
          schemaPath === undefined
            ? await fetchSchemaFromHost(hostUrl, schemaSignal)
            : await readSchemaFile(schemaPath);
        schemaSignal.throwIfAborted();
      } catch (error) {
        abortSignal?.throwIfAborted();
        const detail = (() => {
          if (timeoutSignal.aborted) {
            return "Timed out after 10 seconds." as const;
          }
          if (error instanceof Error) {
            return error.message;
          }
          return String(error);
        })();
        throw new Error(
          schemaPath === undefined
            ? `Unable to fetch the host schema from ${hostUrl}: ${detail}`
            : `Unable to load the host schema snapshot ${schemaPath}: ${detail}`,
          {
            cause: error,
          }
        );
      }
      const chunks = await client.appAgent.chat(
        {
          appId,
          hostUrl,
          messages: messages.filter(
            (message): message is UIMessage & { role: "user" | "assistant" } =>
              message.role !== "system"
          ),
          schema,
        },
        { signal: abortSignal }
      );
      return asyncIteratorToUnproxiedDataStream(chunks);
    },
  };
  await runAgentTUI({
    reasoning: "hidden",
    title: `TailorKit Agent · ${hostUrl}`,
    tools: "collapsed",
    transport,
  });
};
