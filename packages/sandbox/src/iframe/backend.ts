import { AppError } from "@patchsmith/app/client";
import type { ErrorCode, Session } from "@patchsmith/app/client";

/** The bridge only supplies scoped JWTs. Backend RPC traffic goes directly over HTTP and WebSocket. */
export const createIframeBackend = (
  send: (request: { id: string; refresh: boolean }) => void
) => {
  const pending = new Map<
    string,
    {
      resolve: (value: Session) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  return {
    close: () => {
      closed = true;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Sandbox was destroyed"));
      }
      pending.clear();
    },
    getSession: async (input: { refresh: boolean }): Promise<Session> => {
      if (closed) {
        return await Promise.reject(new Error("Sandbox was destroyed"));
      }
      return await (async () => {
        const {
          promise: pendingPromise,
          resolve,
          reject,
        } = Promise.withResolvers<Session>();
        try {
          const id = crypto.randomUUID();
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new AppError("UNAVAILABLE", "JWT bridge timed out"));
          }, 30_000);
          pending.set(id, { reject, resolve, timer });
          send({ id, refresh: input.refresh });
        } catch (error) {
          reject(error);
        }
        return await pendingPromise;
      })();
    },
    receive: (result: {
      id: string;
      session?: Session;
      error?: { code: ErrorCode; message: string };
    }) => {
      const request = pending.get(result.id);
      if (!request) {
        return;
      }
      pending.delete(result.id);
      clearTimeout(request.timer);
      if (result.session) {
        request.resolve(result.session);
      } else {
        request.reject(
          new AppError(
            result.error?.code ?? "UNAVAILABLE",
            result.error?.message ?? "Unable to authorize the app backend"
          )
        );
      }
    },
  };
};
