import { timingSafeEqual } from "node:crypto";

import { hashSecret } from "@patchsmith/api-utils/hashing";

import { env } from "#env";

/** Bind a stream to its authorized app and thread; every reconnect still authenticates. */
export const createAgentStreamToken = (
  appId: string,
  threadId: string,
  runId: string
) => {
  if (env.AUTH_SECRET === undefined || env.AUTH_SECRET === "") {
    throw new Error("AUTH_SECRET is required for agent stream tokens.");
  }
  return hashSecret(
    JSON.stringify(["patchsmith-agent-stream-v1", appId, threadId, runId]),
    env.AUTH_SECRET
  );
};

export const verifyAgentStreamToken = (
  appId: string,
  threadId: string,
  runId: string,
  token: string
) => {
  const expected = Buffer.from(createAgentStreamToken(appId, threadId, runId));
  const received = Buffer.from(token);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
};
