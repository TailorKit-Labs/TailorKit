import { z } from "zod";

import { AppError } from "../errors";
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

export const executeServerTool = async <TInput>(
  session: Session,
  path: string,
  input: TInput,
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
export const callTool = (
  kind: "client" | "server",
  path: string,
  input?: Parameters<ToolBridge["client"]>[1]
): ReturnType<ToolBridge["client"]> => {
  const bridge = globalThis.__tailorkitTools;
  if (!bridge) {
    return Promise.reject(
      new AppError("UNAVAILABLE", "Tool bridge unavailable")
    );
  }
  if (kind === "client") {
    return bridge.client(path, input);
  }
  return bridge
    .session(path)
    .then((session) => executeServerTool(session, path, input));
};
