import type { experimental_CanvasConnection } from "@tailorkit/app/client";

import type { HostToIframePayload } from "#protocol";

type CanvasReply = Extract<
  HostToIframePayload,
  { type: "canvasResult" }
>["data"];

export const createIframeCanvases = (
  send: (data: { id: string; name: string; generation?: string }) => void
) => {
  const pending = new Map<
    string,
    {
      resolve: (connection: experimental_CanvasConnection) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const ports = new Set<MessagePort>();
  const available = new Map<string, string>();
  const listeners = new Map<string, Set<(generation: string | null) => void>>();
  let closed = false;
  const request = async (
    name: string,
    generation?: string
  ): Promise<experimental_CanvasConnection> => {
    if (closed || pending.size >= 8 || name.length === 0 || name.length > 128) {
      throw new Error("Canvas request unavailable.");
    }
    const id = crypto.randomUUID();
    const { promise, resolve, reject } =
      Promise.withResolvers<experimental_CanvasConnection>();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Canvas request timed out."));
    }, 30_000);
    pending.set(id, { reject, resolve, timer });
    try {
      send({ generation, id, name });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    return await promise;
  };
  return {
    availability: (name: string, generation: string | null) => {
      if (closed || (available.get(name) ?? null) === generation) {
        return;
      }
      if (generation === null) {
        available.delete(name);
      } else {
        available.set(name, generation);
      }
      for (const listener of listeners.get(name) ?? []) {
        listener(generation);
      }
    },
    close: () => {
      closed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Sandbox destroyed."));
      }
      pending.clear();
      available.clear();
      for (const entries of listeners.values()) {
        for (const listener of entries) {
          listener(null);
        }
      }
      listeners.clear();
      for (const port of ports) {
        port.postMessage({ type: "close" });
        port.close();
      }
      ports.clear();
    },
    receive: ({ id, port, width, height, error }: CanvasReply) => {
      const entry = pending.get(id);
      if (!entry) {
        port?.postMessage({ type: "close" });
        port?.close();
        return;
      }
      pending.delete(id);
      clearTimeout(entry.timer);
      if (
        closed ||
        error !== undefined ||
        !port ||
        width === undefined ||
        height === undefined
      ) {
        port?.close();
        entry.reject(new Error(error ?? "Canvas surface unavailable."));
        return;
      }
      ports.add(port);
      entry.resolve({
        height,
        port,
        release: () => {
          ports.delete(port);
        },
        width,
      });
    },
    request,
    watch: (name: string, listener: (generation: string | null) => void) => {
      const entries = listeners.get(name) ?? new Set();
      entries.add(listener);
      listeners.set(name, entries);
      listener(available.get(name) ?? null);
      return () => {
        entries.delete(listener);
        if (entries.size === 0) {
          listeners.delete(name);
        }
      };
    },
  };
};
