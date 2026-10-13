import { z } from "zod";

import { AppError } from "#errors";

import type { Session } from "./session";

export interface ToolBridge<TInput = unknown, TOutput = unknown> {
  client: (path: string, input: TInput) => Promise<TOutput>;
  session: (path: string) => Promise<Session>;
}

// These globals are the explicit ABI installed by the host and sandbox runtime.
declare global {
  var __tailorkitTools: ToolBridge | undefined;
  var __tailorkitBackendSession:
    | ((options: { refresh: boolean }) => Promise<Session>)
    | undefined;
}

// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Generated bindings augment this public interface through declaration merging.
export interface TailorKitServerTools {}

export const executeServerTool = async (
  session: Session,
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser, serializer, or runtime adapter handles arbitrary values before validating or encoding their domain representation.
  input: unknown,
  request: typeof fetch = globalThis.fetch,
  signal?: AbortSignal
) => {
  const response = await request(session.url, {
    body: JSON.stringify({ input, path, requestId: crypto.randomUUID() }),
    credentials: "omit",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    method: "POST",
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    throw new AppError(
      (() => {
        if (response.status === 401) {
          return "UNAUTHORIZED" as const;
        }
        if (response.status === 400) {
          return "BAD_REQUEST" as const;
        }
        return "UNAVAILABLE" as const;
      })(),
      "Tool call failed"
    );
  }
  return z
    .object({ output: z.unknown().optional() })
    .parse(await response.json()).output;
};

/** Generated callers delegate only transport; host/server declarations validate both directions. */
export const callTool = async (
  kind: "client" | "server",
  path: string,
  input?: Parameters<ToolBridge["client"]>[1]
): ReturnType<ToolBridge["client"]> => {
  const bridge = globalThis.__tailorkitTools;
  if (!bridge) {
    throw new AppError("UNAVAILABLE", "Tool bridge unavailable");
  }
  if (kind === "client") {
    return await bridge.client(path, input);
  }
  return await bridge
    .session(path)
    .then(async (session) => await executeServerTool(session, path, input));
};
