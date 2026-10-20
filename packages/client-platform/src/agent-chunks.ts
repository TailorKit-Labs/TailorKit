import type { UIMessageChunk } from "ai";
import * as v from "valibot";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

const jsonValue: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.null(),
    v.string(),
    v.pipe(v.number(), v.finite()),
    v.boolean(),
    v.record(v.string(), v.optional(jsonValue)),
    v.array(jsonValue),
  ])
);

const metadata = v.record(v.string(), v.optional(jsonValue));
const providerMetadata = v.optional(v.record(v.string(), metadata));
const text = { id: v.string(), providerMetadata };

const tool = {
  dynamic: v.optional(v.boolean()),
  providerExecuted: v.optional(v.boolean()),
  providerMetadata,
  toolCallId: v.string(),
  toolMetadata: v.optional(metadata),
};

const toolInput = {
  ...tool,
  title: v.optional(v.string()),
  toolName: v.string(),
};

// Keep the host wire contract independent of the SDK's runtime validator.
// The exhaustive keys catch new SDK chunk types during typechecking; parity tests
// check validation against the SDK at the package's installed version.
const chunks = {
  abort: v.looseObject({
    reason: v.optional(v.string()),
    type: v.literal("abort"),
  }),
  custom: v.looseObject({
    // The SDK accepts every string here, while exposing a dotted name type.
    kind: v.custom<`${string}.${string}`>((value) => v.is(v.string(), value)),
    providerMetadata,
    type: v.literal("custom"),
  }),
  error: v.looseObject({ errorText: v.string(), type: v.literal("error") }),
  file: v.looseObject({
    mediaType: v.string(),
    providerMetadata,
    type: v.literal("file"),
    url: v.string(),
  }),
  finish: v.looseObject({
    finishReason: v.optional(
      v.picklist([
        "stop",
        "length",
        "content-filter",
        "tool-calls",
        "error",
        "other",
      ])
    ),
    messageMetadata: v.optional(v.unknown()),
    type: v.literal("finish"),
  }),
  "finish-step": v.looseObject({ type: v.literal("finish-step") }),
  "message-metadata": v.looseObject({
    messageMetadata: v.unknown(),
    type: v.literal("message-metadata"),
  }),
  "reasoning-delta": v.looseObject({
    type: v.literal("reasoning-delta"),
    ...text,
    delta: v.string(),
  }),
  "reasoning-end": v.looseObject({ type: v.literal("reasoning-end"), ...text }),
  "reasoning-file": v.looseObject({
    mediaType: v.string(),
    providerMetadata,
    type: v.literal("reasoning-file"),
    url: v.string(),
  }),
  "reasoning-start": v.looseObject({
    type: v.literal("reasoning-start"),
    ...text,
  }),
  "reset-step": v.looseObject({ type: v.literal("reset-step") }),
  "source-document": v.looseObject({
    filename: v.optional(v.string()),
    mediaType: v.string(),
    providerMetadata,
    sourceId: v.string(),
    title: v.string(),
    type: v.literal("source-document"),
  }),
  "source-url": v.looseObject({
    providerMetadata,
    sourceId: v.string(),
    title: v.optional(v.string()),
    type: v.literal("source-url"),
    url: v.string(),
  }),
  start: v.looseObject({
    messageId: v.optional(v.string()),
    messageMetadata: v.optional(v.unknown()),
    type: v.literal("start"),
  }),
  "start-step": v.looseObject({ type: v.literal("start-step") }),
  "text-delta": v.looseObject({
    type: v.literal("text-delta"),
    ...text,
    delta: v.string(),
  }),
  "text-end": v.looseObject({ type: v.literal("text-end"), ...text }),
  "text-start": v.looseObject({ type: v.literal("text-start"), ...text }),
  "tool-approval-request": v.looseObject({
    approvalDescriptor: v.optional(v.unknown()),
    approvalId: v.string(),
    inputSchemaInput: v.optional(v.unknown()),
    isAutomatic: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    signature: v.optional(v.string()),
    toolCallId: v.string(),
    type: v.literal("tool-approval-request"),
  }),
  "tool-approval-response": v.looseObject({
    approvalId: v.string(),
    approved: v.boolean(),
    providerExecuted: v.optional(v.boolean()),
    providerMetadata,
    reason: v.optional(v.string()),
    type: v.literal("tool-approval-response"),
  }),
  "tool-input-available": v.looseObject({
    type: v.literal("tool-input-available"),
    ...toolInput,
    input: v.unknown(),
  }),
  "tool-input-delta": v.looseObject({
    inputTextDelta: v.string(),
    toolCallId: v.string(),
    type: v.literal("tool-input-delta"),
  }),
  "tool-input-error": v.looseObject({
    type: v.literal("tool-input-error"),
    ...toolInput,
    errorText: v.string(),
    input: v.unknown(),
  }),
  "tool-input-start": v.looseObject({
    type: v.literal("tool-input-start"),
    ...toolInput,
  }),
  "tool-output-available": v.looseObject({
    type: v.literal("tool-output-available"),
    ...tool,
    output: v.unknown(),
    preliminary: v.optional(v.boolean()),
  }),
  "tool-output-denied": v.looseObject({
    toolCallId: v.string(),
    type: v.literal("tool-output-denied"),
  }),
  "tool-output-error": v.looseObject({
    type: v.literal("tool-output-error"),
    ...tool,
    errorText: v.string(),
  }),
} satisfies Record<
  Exclude<UIMessageChunk["type"], `data-${string}`>,
  v.GenericSchema
>;

export const agentChunkSchema: v.GenericSchema<unknown, UIMessageChunk> =
  v.union([
    v.looseObject({
      data: v.unknown(),
      id: v.optional(v.string()),
      transient: v.optional(v.boolean()),
      type: v.custom<`data-${string}`>((value) =>
        v.is(v.pipe(v.string(), v.startsWith("data-")), value)
      ),
    }),
    v.variant("type", Object.values(chunks)),
  ]);
