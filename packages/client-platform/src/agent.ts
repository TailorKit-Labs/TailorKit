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
  schema: z.record(z.string(), z.unknown()).optional(),
});
