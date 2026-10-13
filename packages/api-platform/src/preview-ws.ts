import { asyncIteratorObject, ORPCError, os } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { db } from "@tailorkit/db";
import { getKV } from "@tailorkit/kv";
import { sanitizeErrorForLog } from "@tailorkit/observability";
import { z } from "zod";

import {
  createPreviewBuildStore,
  previewChunkBytes,
  previewMessageBytes,
} from "./preview-build-store";
import {
  previewCliCredentialActive,
  endPreviewSession,
  ensurePreviewDeveloperGrace,
  recordPreviewHeartbeat,
} from "./preview-lifecycle";

const file = z.object({
  chunks: z.number().int().min(0).max(4),
  contentType: z.string().min(1).max(255),
  path: z.string().min(1).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  size: z
    .number()
    .int()
    .min(0)
    .max(1024 * 1024),
});
const manifest = z.object({ files: z.array(file).max(100) });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const event = z.discriminatedUnion("type", [
  z.object({
    buildId: id,
    manifest,
    revision: z.number().int(),
    type: z.literal("begin"),
  }),
  z.object({
    base64: z.string().max(4 * Math.ceil(previewChunkBytes / 3)),
    chunkIndex: z.number().int(),
    fileIndex: z.number().int(),
    revision: z.number().int(),
    type: z.literal("chunk"),
  }),
  z.object({ revision: z.number().int(), type: z.literal("complete") }),
  z.object({ type: z.literal("ended") }),
]);

const logPreviewOperationFailure = async <T>(
  operation: string,
  run: () => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    console.error("Preview WebSocket operation failed", {
      error: sanitizeErrorForLog(error),
      operation,
    });
    throw error;
  }
};

export type PreviewWebSocketContext =
  | {
      sessionId: string;
      role: "uploader";
    }
  | {
      sessionId: string;
      role: "viewer";
      viewerTokenExpiresAt: number;
    };

const requireFreshViewerToken = (context: PreviewWebSocketContext): void => {
  if (context.role !== "viewer" || context.viewerTokenExpiresAt <= Date.now()) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Preview viewer token expired.",
    });
  }
};

const o = os.$context<PreviewWebSocketContext>();
const requireRole = async (
  context: PreviewWebSocketContext,
  role: PreviewWebSocketContext["role"]
) => {
  if (context.role !== role) {
    throw new ORPCError("FORBIDDEN");
  }
  const session = await db.query.previewSession.findFirst({
    where: { id: context.sessionId, status: "active" },
    with: { cliToken: true },
  });
  if (!session || session.expiresAt <= new Date()) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Preview session is unavailable.",
    });
  }
  const kv = getKV();
  if (!kv) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Preview storage is unavailable: configure KV.",
    });
  }
  if (role === "uploader" && !(await previewCliCredentialActive(kv, session))) {
    await endPreviewSession(kv, context.sessionId);
    throw new ORPCError("UNAUTHORIZED", {
      message: "Preview CLI token is unavailable.",
    });
  }
  if (!(await ensurePreviewDeveloperGrace(kv, context.sessionId))) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Preview developer reconnect grace expired.",
    });
  }
  return createPreviewBuildStore(kv);
};

const beginBuild = o
  .input(z.object({ manifest }))
  .output(z.object({ buildId: id }))
  .handler(({ context, input }) =>
    logPreviewOperationFailure("begin", async () => {
      const store = await requireRole(context, "uploader");
      return { buildId: await store.begin(context.sessionId, input.manifest) };
    })
  );
const uploadChunk = o
  .input(
    z.object({
      base64: z.string().max(4 * Math.ceil(previewChunkBytes / 3)),
      buildId: id,
      chunkIndex: z.number().int().min(0).max(3),
      fileIndex: z.number().int().min(0).max(99),
    })
  )
  .output(z.object({ accepted: z.literal(true) }))
  .handler(({ context, input }) =>
    logPreviewOperationFailure("upload_chunk", async () => {
      if (Buffer.byteLength(JSON.stringify(input)) > previewMessageBytes) {
        throw new ORPCError("PAYLOAD_TOO_LARGE");
      }
      const store = await requireRole(context, "uploader");
      await store.upload(
        context.sessionId,
        input.buildId,
        input.fileIndex,
        input.chunkIndex,
        input.base64
      );
      return { accepted: true as const };
    })
  );
const commitBuild = o
  .input(z.object({ buildId: id }))
  .output(z.object({ revision: z.number().int() }))
  .handler(({ context, input }) =>
    logPreviewOperationFailure("commit", async () => {
      const store = await requireRole(context, "uploader");
      const result = await store.commit(context.sessionId, input.buildId);
      return { revision: result.revision };
    })
  );
const heartbeat = o
  .output(z.object({ accepted: z.literal(true) }))
  .handler(async ({ context }) => {
    await requireRole(context, "uploader");
    const kv = getKV();
    if (!kv) {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
    if (!(await recordPreviewHeartbeat(kv, context.sessionId))) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Preview session is unavailable.",
      });
    }
    return { accepted: true as const };
  });

const subscribe = o
  .output(asyncIteratorObject(event))
  .handler(async function* subscribe({ context }) {
    requireFreshViewerToken(context);
    const store = await requireRole(context, "viewer");
    let wake: (() => void) | undefined;
    const waitForSignal = () =>
      (() => {
        const {
          promise: pendingPromise,
          resolve,
          reject: rejectPending,
        } = Promise.withResolvers<ReturnType<() => void>>();
        try {
          wake = resolve;
        } catch (error) {
          rejectPending(error);
        }
        return pendingPromise;
      })();
    let signalled = true;
    const notify = () => {
      signalled = true;
      wake?.();
    };
    const unsubscribe = await store.subscribe(context.sessionId, notify);
    const timer = setInterval(notify, 10_000);
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const notifyWhenExpired = () => {
      if (context.role !== "viewer") {
        return;
      }
      const remaining = context.viewerTokenExpiresAt - Date.now();
      if (remaining > 0) {
        expiryTimer = setTimeout(notifyWhenExpired, remaining);
      } else {
        notify();
      }
    };
    notifyWhenExpired();
    let lastRevision = 0;
    try {
      for (;;) {
        if (!signalled) {
          // oxlint-disable-next-line no-await-in-loop -- Stream reads and cancellation must stay ordered and bounded.
          await waitForSignal();
        }
        wake = undefined;
        signalled = false;
        requireFreshViewerToken(context);
        try {
          // oxlint-disable-next-line no-await-in-loop -- Stream reads and cancellation must stay ordered and bounded.
          await requireRole(context, "viewer");
        } catch {
          yield { type: "ended" as const };
          break;
        }
        // oxlint-disable-next-line no-await-in-loop -- Stream reads and cancellation must stay ordered and bounded.
        const build = await store.current(context.sessionId);
        if (!build || build.revision <= lastRevision) {
          continue;
        }
        const { buildId, manifest: manifestValue, revision } = build;
        requireFreshViewerToken(context);
        yield {
          buildId,
          manifest: manifestValue,
          revision,
          type: "begin" as const,
        };
        let complete = true;
        for (const [fileIndex, fileValue] of manifestValue.files.entries()) {
          for (
            let chunkIndex = 0;
            chunkIndex < fileValue.chunks;
            chunkIndex += 1
          ) {
            // oxlint-disable-next-line no-await-in-loop -- Stream reads and cancellation must stay ordered and bounded.
            const base64 = await store.chunk(
              context.sessionId,
              buildId,
              fileIndex,
              chunkIndex
            );
            if (base64 === null) {
              complete = false;
              break;
            }
            requireFreshViewerToken(context);
            yield {
              base64,
              chunkIndex,
              fileIndex,
              revision,
              type: "chunk" as const,
            };
          }
          if (!complete) {
            break;
          }
        }
        if (complete) {
          requireFreshViewerToken(context);
          yield { revision, type: "complete" as const };
          lastRevision = revision;
        }
      }
    } finally {
      clearInterval(timer);
      clearTimeout(expiryTimer);
      await unsubscribe();
    }
  });

export const previewWebSocketRouter = {
  beginBuild,
  commitBuild,
  heartbeat,
  subscribe,
  uploadChunk,
};
export type PreviewWebSocketRouterClient = RouterClient<
  typeof previewWebSocketRouter
>;
