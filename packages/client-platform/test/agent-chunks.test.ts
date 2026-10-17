import { asSchema, uiMessageChunkSchema } from "ai";
import type { UIMessageChunk } from "ai";
import * as v from "valibot";
import { expect, it } from "vite-plus/test";

import { agentChunkSchema } from "#agent-chunks";

const chunks = {
  abort: { reason: "cancelled", type: "abort" },
  custom: { kind: "provider.event", type: "custom" },
  error: { errorText: "failed", type: "error" },
  file: {
    mediaType: "text/plain",
    type: "file",
    url: "https://example.com/file",
  },
  finish: { finishReason: "stop", type: "finish" },
  "finish-step": { type: "finish-step" },
  "message-metadata": { messageMetadata: {}, type: "message-metadata" },
  "reasoning-delta": { delta: "think", id: "reason", type: "reasoning-delta" },
  "reasoning-end": { id: "reason", type: "reasoning-end" },
  "reasoning-file": {
    mediaType: "text/plain",
    type: "reasoning-file",
    url: "https://example.com/file",
  },
  "reasoning-start": { id: "reason", type: "reasoning-start" },
  "reset-step": { type: "reset-step" },
  "source-document": {
    mediaType: "text/plain",
    sourceId: "source",
    title: "Document",
    type: "source-document",
  },
  "source-url": {
    sourceId: "source",
    type: "source-url",
    url: "https://example.com",
  },
  start: {
    messageId: "message",
    messageMetadata: { custom: true },
    type: "start",
  },
  "start-step": { type: "start-step" },
  "text-delta": { delta: "hello", id: "text", type: "text-delta" },
  "text-end": { id: "text", type: "text-end" },
  "text-start": { id: "text", type: "text-start" },
  "tool-approval-request": {
    approvalId: "approval",
    toolCallId: "call",
    type: "tool-approval-request",
  },
  "tool-approval-response": {
    approvalId: "approval",
    approved: true,
    type: "tool-approval-response",
  },
  "tool-input-available": {
    input: {},
    toolCallId: "call",
    toolName: "read",
    type: "tool-input-available",
  },
  "tool-input-delta": {
    inputTextDelta: "{}",
    toolCallId: "call",
    type: "tool-input-delta",
  },
  "tool-input-error": {
    errorText: "failed",
    input: {},
    toolCallId: "call",
    toolName: "read",
    type: "tool-input-error",
  },
  "tool-input-start": {
    toolCallId: "call",
    toolName: "read",
    type: "tool-input-start",
  },
  "tool-output-available": {
    output: {},
    toolCallId: "call",
    type: "tool-output-available",
  },
  "tool-output-denied": { toolCallId: "call", type: "tool-output-denied" },
  "tool-output-error": {
    errorText: "failed",
    toolCallId: "call",
    type: "tool-output-error",
  },
} satisfies Record<
  Exclude<UIMessageChunk["type"], `data-${string}`>,
  UIMessageChunk
>;

const sdk = asSchema(uiMessageChunkSchema);

it.each(Object.values(chunks))(
  "matches the SDK validator for $type chunks and malformed fields",
  async (chunk) => {
    const validateSdk = sdk.validate;
    if (!validateSdk) {
      throw new Error("The SDK must supply a chunk validator");
    }
    const candidates: object[] = [chunk, { ...chunk, futureField: true }];
    for (const key of Object.keys(chunk)) {
      const omitted = { ...chunk };
      Reflect.deleteProperty(omitted, key);
      candidates.push(omitted);
      for (const value of [null, undefined, 1, true, {}, [], "unexpected"]) {
        candidates.push({ ...chunk, [key]: value });
      }
    }
    for (const candidate of candidates) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Compare each candidate to the asynchronous upstream validator with a failure tied to that input.
      const expected = await validateSdk(candidate);
      const actual = v.safeParse(agentChunkSchema, candidate);
      expect(actual.success, JSON.stringify(candidate)).toBe(expected.success);
      if (actual.success && expected.success) {
        expect(actual.output).toEqual(expected.value);
      }
    }
  }
);

it.each([
  { data: { nested: [null, true, 1] }, transient: true, type: "data-custom" },
  { data: undefined, type: "data-" },
  { id: 1, type: "data-custom" },
  {
    id: "text",
    providerMetadata: { provider: { value: [null, { key: undefined }] } },
    type: "text-start",
  },
  {
    id: "text",
    providerMetadata: { provider: { invalid: Number.POSITIVE_INFINITY } },
    type: "text-start",
  },
  {
    dynamic: false,
    output: undefined,
    preliminary: true,
    providerExecuted: true,
    toolCallId: "call",
    toolMetadata: { key: undefined },
    type: "tool-output-available",
  },
  {
    output: null,
    toolCallId: "call",
    toolMetadata: { invalid: () => null },
    type: "tool-output-available",
  },
  { type: "unknown" },
  null,
  42,
])(
  "matches the SDK for metadata, custom data, and invalid envelopes: %j",
  async (candidate) => {
    const expected = await sdk.validate?.(candidate);
    expect(v.safeParse(agentChunkSchema, candidate).success).toBe(
      expected?.success
    );
  }
);
