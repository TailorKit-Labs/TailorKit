import { setTimeout as delay } from "node:timers/promises";

import { runAgentTUI } from "@ai-sdk/tui";
import { log } from "@clack/prompts";
import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import {
  agentThreadChunkSchema,
  agentRunChunkSchema,
  agentRunCompleteChunkSchema,
} from "@tailorkit/client-platform/agent";
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import { fetchSchemaFromHost, readSchemaFile } from "./generator/types";
import type { TailorKitSchemaFile } from "./generator/types";

const schemaFetchTimeoutMs = 10_000;

interface AgentTuiOptions {
  client: Pick<TailorKitRouterClient, "appAgent">;
  hostUrl: string;
  appId: string;
  schemaPath?: string;
  threadId?: string;
}

export const openAgentTui = async ({
  client,
  hostUrl,
  appId,
  schemaPath,
  threadId: requestedThreadId,
}: AgentTuiOptions) => {
  let threadId = requestedThreadId;
  type ChatInput = Parameters<TailorKitRouterClient["appAgent"]["chat"]>[0];
  let resume: ChatInput["resume"];
  let pendingInput: ChatInput | undefined;
  const connect = async (
    input: ChatInput,
    signal?: AbortSignal
  ): Promise<AsyncIterable<UIMessageChunk>> => {
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- The generated RPC event iterator type is erased; the host validates each chunk.
    const chunks: AsyncIterable<UIMessageChunk> = await client.appAgent.chat(
      input,
      { signal }
    );
    return chunks;
  };
  const readTurn = async function* readTurn(
    input: ChatInput,
    signal?: AbortSignal,
    initial?: AsyncIterable<UIMessageChunk>
  ): AsyncGenerator<UIMessageChunk> {
    let initialChunks = initial;
    let failures = 0;
    let finished = false;
    while (true) {
      signal?.throwIfAborted();
      const startIndex = resume?.startIndex ?? 0;
      try {
        const request =
          resume === undefined ? input : { ...input, resume, threadId };
        const nextChunks = initialChunks ?? connect(request, signal);
        // oxlint-disable-next-line no-await-in-loop -- Connect sequentially from the last received chunk to avoid overlapping readers.
        const chunks = await nextChunks;
        initialChunks = undefined;
        // oxlint-disable-next-line no-await-in-loop -- Each chunk advances the reconnect cursor before reading the next one.
        for await (const chunk of chunks) {
          const thread = agentThreadChunkSchema.safeParse(chunk);
          const run = agentRunChunkSchema.safeParse(chunk);
          const complete = agentRunCompleteChunkSchema.safeParse(chunk);
          if (thread.success) {
            ({ threadId } = thread.data.data);
          } else if (run.success) {
            resume = { ...run.data.data, startIndex };
          } else if (complete.success) {
            finished = true;
          } else {
            if (resume !== undefined) {
              resume = { ...resume, startIndex: resume.startIndex + 1 };
            }
            failures = 0;
            if (chunk.type === "finish" || chunk.type === "error") {
              finished = true;
            }
            if (chunk.type === "error") {
              // The SDK may cancel consumption as soon as it sees this terminal error.
              resume = undefined;
              pendingInput = undefined;
            }
          }
          yield chunk;
        }
        if (finished) {
          resume = undefined;
          pendingInput = undefined;
          return;
        }
        throw new Error("The agent stream ended before the turn completed.");
      } catch (error) {
        signal?.throwIfAborted();
        failures += 1;
        if (resume === undefined || failures > 3) {
          throw error;
        }
        // oxlint-disable-next-line no-await-in-loop -- Retry this read, never the initial workflow submission; abort interrupts the backoff.
        await delay(1000 * failures, undefined, { signal });
      }
    }
  };
  const transport: ChatTransport<UIMessage> = {
    // oxlint-disable-next-line eslint/require-await -- ChatTransport requires a Promise although stream creation is synchronous.
    reconnectToStream: async ({ abortSignal }) =>
      pendingInput === undefined || resume === undefined
        ? null
        : asyncIteratorToUnproxiedDataStream(
            readTurn(pendingInput, abortSignal)
          ),
    sendMessages: async ({ messages, abortSignal }) => {
      if (resume !== undefined && pendingInput !== undefined) {
        // Settle the disconnected turn before submitting this follow-up.
        // Its full history lives in Pi's journal, even if the terminal missed it.
        for await (const _chunk of readTurn(pendingInput, abortSignal)) {
          /* consume */
        }
      }
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
      pendingInput = {
        appId,
        hostUrl,
        messages: messages.filter(
          (message): message is UIMessage & { role: "user" | "assistant" } =>
            message.role !== "system"
        ),
        schema,
        threadId,
      };
      const initial = await connect(pendingInput, abortSignal);
      return asyncIteratorToUnproxiedDataStream(
        readTurn(pendingInput, abortSignal, initial)
      );
    },
  };
  await runAgentTUI({
    reasoning: "hidden",
    title: `TailorKit Agent · ${hostUrl}`,
    tools: "collapsed",
    transport,
  });
  if (threadId !== undefined) {
    log.info(`Thread: ${threadId} (resume with --thread ${threadId})`);
  }
};
