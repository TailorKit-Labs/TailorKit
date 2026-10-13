import { AppError } from "../errors";
import type { Session } from "./session";

export interface ToolBridge {
  client: (path: string, input: unknown) => Promise<unknown>;
  session: (path: string) => Promise<Session>;
}

// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Generated bindings augment this public interface through declaration merging.
export interface TailorKitServerTools {}

export const executeServerTool = async (
  session: Session,
  path: string,
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
  return ((await response.json()) as { output?: unknown }).output;
};

/** Generated callers delegate only transport; host/server declarations validate both directions. */
export const callTool = (
  kind: "client" | "server",
  path: string,
  input?: unknown
): Promise<unknown> => {
  const bridge = (
    globalThis as typeof globalThis & { __tailorkitTools?: ToolBridge }
  ).__tailorkitTools;
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
