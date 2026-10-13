import type { ToolBridge } from "@tailorkit/app/client";
import { parseSession } from "@tailorkit/app/client/connection";

import type { HostToIframePayload } from "../protocol";

type ToolReply = Extract<HostToIframePayload, { type: "toolResult" }>["data"];
type ToolOutput = ToolReply["output"];

export const createIframeTools = (
  send: (input: {
    id: string;
    kind: "client" | "server";
    path: string;
    input?: Parameters<ToolBridge["client"]>[1];
  }) => void
) => {
  const pending = new Map<
    string,
    {
      resolve: (value: ToolOutput) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  const request = (
    kind: "client" | "server",
    path: string,
    input?: Parameters<ToolBridge["client"]>[1]
  ): Promise<ToolOutput> => {
    if (closed) {
      return Promise.reject(new Error("Sandbox destroyed"));
    }
    if (pending.size >= 32) {
      return Promise.reject(new Error("Too many pending tool requests"));
    }
    return (() => {
      const {
        promise: pendingPromise,
        resolve,
        reject,
      } = Promise.withResolvers();
      try {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Tool request timed out"));
        }, 30_000);
        pending.set(id, { reject, resolve, timer });
        send({ id, input, kind, path });
      } catch (error) {
        reject(error);
      }
      return pendingPromise;
    })();
  };
  const bridge: ToolBridge = {
    client: (path, input) => request("client", path, input),
    session: async (path) => parseSession(await request("server", path)),
  };
  return {
    bridge,
    close() {
      closed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Sandbox destroyed"));
      }
      pending.clear();
    },
    receive(result: ToolReply) {
      const entry = pending.get(result.id);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      pending.delete(result.id);
      if (result.error) {
        entry.reject(new Error(result.error));
      } else {
        entry.resolve(result.output);
      }
    },
  };
};
