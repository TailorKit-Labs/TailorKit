import { asSchema, uiMessageChunkSchema } from "ai";
import type { UIMessageChunk } from "ai";
import { z } from "zod";

const chunkSchema = asSchema(uiMessageChunkSchema);

/** Use the SDK's validator so transport parts stay aligned with its protocol. */
export const agentChunkSchema = z
  .custom<UIMessageChunk>(async (value) => {
    const awaitedResult1 = await chunkSchema.validate?.(value);
    return awaitedResult1?.success === true;
  })
  .describe("An AI SDK UIMessageChunk. Fields depend on the chunk type.");

export type AgentChunk = UIMessageChunk;
/** Parts stay extensible; the platform validates their SDK shapes before running. */
export const agentMessagesSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      metadata: z.unknown().optional(),
      parts: z.array(z.looseObject({ type: z.string() })).min(1),
      role: z.enum(["user", "assistant"]),
    })
  )
  .min(1);

export const agentChatSchema = z.object({
  appId: z.string().min(1),
  hostUrl: z.url({ protocol: /^https?$/u }),
  messages: agentMessagesSchema,
  resume: z
    .object({
      runId: z.string().startsWith("wrun_"),
      startIndex: z.number().int().nonnegative(),
      token: z.string().min(1),
    })
    .optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  threadId: z.uuid().optional(),
});

/** The signed run identity permits reconnecting without submitting another turn. */
export const agentRunChunkSchema = z.object({
  data: z.object({
    runId: z.string().startsWith("wrun_"),
    token: z.string().min(1),
  }),
  transient: z.literal(true),
  type: z.literal("data-run"),
});

export const agentRunCompleteChunkSchema = z.object({
  data: z.object({ runId: z.string().startsWith("wrun_") }),
  transient: z.literal(true),
  type: z.literal("data-run-complete"),
});

/** Transient metadata communicates the server-selected conversation ID. */
export const agentThreadChunkSchema = z.object({
  data: z.object({ threadId: z.uuid() }),
  transient: z.literal(true),
  type: z.literal("data-thread"),
});
