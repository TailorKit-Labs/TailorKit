import { setTimeout as delay } from "node:timers/promises";

import { runAgentTUI } from "@ai-sdk/tui";
import { log } from "@clack/prompts";
import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import {
  agentRunChunkSchema,
  agentRunCompleteChunkSchema,
} from "@patchsmith/client-platform/agent";
import type { AgentRunCursor } from "@patchsmith/client-platform/agent";
import type { PatchSmithRouterClient } from "@patchsmith/core/server";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import * as v from "valibot";

import { fetchSchemaFromHost, readSchemaFile } from "./generator/types";
import type { PatchSmithSchemaFile } from "./generator/types";

const schemaFetchTimeoutMs = 10_000;

interface AgentTuiOptions {
  client: { appAgent: Pick<PatchSmithRouterClient["appAgent"], "chat"> };
  hostUrl: string;
  appId: string;
  schemaPath?: string;
  threadId?: string;
}

export const openAgentTui = async (
  {
    client,
    hostUrl,
    appId,
    schemaPath,
    threadId: requestedThreadId,
  }: AgentTuiOptions,
  waitForRetry = async (milliseconds: number, signal?: AbortSignal) => {
    await delay(milliseconds, undefined, { signal });
  }
) => {
  let threadId = requestedThreadId;
  type ChatInput = Parameters<PatchSmithRouterClient["appAgent"]["chat"]>[0];
  let resume: AgentRunCursor | undefined;
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
  const connectResume = async (signal?: AbortSignal) => {
    if (resume === undefined) {
      throw new Error("Agent stream did not include its run identity.");
    }
    return await connect({ appId, type: "resume", ...resume }, signal);
  };
  const readTurn = async function* readTurn(
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
        const nextChunks = initialChunks ?? connectResume(signal);
        // oxlint-disable-next-line no-await-in-loop -- Connect sequentially from the last received chunk to avoid overlapping readers.
        const chunks = await nextChunks;
        initialChunks = undefined;
        // oxlint-disable-next-line no-await-in-loop -- Each chunk advances the reconnect cursor before reading the next one.
        for await (const chunk of chunks) {
          const run = v.safeParse(agentRunChunkSchema, chunk);
          const complete = v.safeParse(agentRunCompleteChunkSchema, chunk);
          if (run.success) {
            ({ threadId } = run.output.data);
            resume = { ...run.output.data, startIndex };
          } else if (
            complete.success &&
            complete.output.data.runId === resume?.runId
          ) {
            finished = true;
          } else {
            if (resume !== undefined) {
              resume = { ...resume, startIndex: resume.startIndex + 1 };
            }
            failures = 0;
            if (chunk.type === "error") {
              finished = true;
              // The SDK may cancel consumption as soon as it sees this terminal error.
              resume = undefined;
            }
          }
          yield chunk;
        }
        if (finished) {
          resume = undefined;
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
        await waitForRetry(1000 * failures, signal);
      }
    }
  };
  const transport: ChatTransport<UIMessage> = {
    // oxlint-disable-next-line eslint/require-await -- ChatTransport requires a Promise although stream creation is synchronous.
    reconnectToStream: async ({ abortSignal }) =>
      resume === undefined
        ? null
        : asyncIteratorToUnproxiedDataStream(readTurn(abortSignal)),
    sendMessages: async ({ messages, abortSignal }) => {
      if (resume !== undefined) {
        // Settle the disconnected turn before submitting this follow-up.
        // Its full history lives in Pi's journal, even if the terminal missed it.
        for await (const _chunk of readTurn(abortSignal)) {
          /* consume */
        }
      }
      const timeoutSignal = AbortSignal.timeout(schemaFetchTimeoutMs);
      const schemaSignal = abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal;
      let schema: PatchSmithSchemaFile;
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
      const input: ChatInput = {
        appId,
        hostUrl,
        messages: messages.filter(
          (message): message is UIMessage & { role: "user" | "assistant" } =>
            message.role !== "system"
        ),
        schema,
        threadId,
        type: "turn",
      };
      const initial = await connect(input, abortSignal);
      return asyncIteratorToUnproxiedDataStream(readTurn(abortSignal, initial));
    },
  };
  await runAgentTUI({
    reasoning: "hidden",
    title: `PatchSmith Agent · ${hostUrl}`,
    tools: "collapsed",
    transport,
  });
  if (threadId !== undefined) {
    log.info(`Thread: ${threadId} (resume with --thread ${threadId})`);
  }
};
