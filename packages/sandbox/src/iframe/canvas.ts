import type { CanvasConnection } from "@tailorkit/app/client";

import type { HostToIframePayload } from "#protocol";

type CanvasReply = Extract<
  HostToIframePayload,
  { type: "canvasResult" }
>["data"];

export const createIframeCanvases = (
  send: (data: { id: string; name: string }) => void
) => {
  const pending = new Map<
    string,
    {
      resolve: (connection: CanvasConnection) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const ports = new Set<MessagePort>();
  let closed = false;
  const request = async (name: string): Promise<CanvasConnection> => {
    if (closed || pending.size >= 8 || name.length === 0 || name.length > 128) {
      throw new Error("Canvas request unavailable.");
    }
    const id = crypto.randomUUID();
    const { promise, resolve, reject } =
      Promise.withResolvers<CanvasConnection>();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Canvas request timed out."));
    }, 30_000);
    pending.set(id, { reject, resolve, timer });
    try {
      send({ id, name });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    return await promise;
  };
  return {
    close: () => {
      closed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Sandbox destroyed."));
      }
      pending.clear();
      for (const port of ports) {
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
  };
};
