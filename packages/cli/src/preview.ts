import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { log } from "@clack/prompts";
import {
  createPreviewWebSocketClient,
  previewBuildManifestSchema,
} from "@tailorkit/client-platform/preview";
import type {
  PreviewBuildManifest,
  PreviewWebSocketClient,
} from "@tailorkit/client-platform/preview";
import { loadTailorKitConfig } from "@tailorkit/vite/config/loader";
import pc from "picocolors";
import { z } from "zod";

import { getDeployToken, runWhoami } from "./auth";
import { buildProject } from "./build";
import { createCliClient } from "./client";

const chunkBytes = 256 * 1024;
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};
const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
const isEndedSessionError = (err2: unknown): boolean =>
  err2 !== null &&
  typeof err2 === "object" &&
  "code" in err2 &&
  err2.code === "UNAUTHORIZED" &&
  "message" in err2 &&
  typeof err2.message === "string" &&
  /Preview session is unavailable|Preview developer reconnect grace expired|Preview CLI token is unavailable/u.test(
    err2.message
  );

export interface PreviewOptions {
  configPath?: string;
  cwd: string;
  mode?: string;
  outDir?: string;
  replace?: boolean;
}
interface Snapshot {
  files: Buffer[];
  manifest: PreviewBuildManifest;
  fingerprint: string;
}

export const capturePreviewSnapshot = async (
  root: string
): Promise<Snapshot> => {
  const actualRoot = await realpath(root);
  const outputEntries = await readdir(actualRoot, {
    recursive: true,
    withFileTypes: true,
  });
  const entries = outputEntries
    .filter((entry) => entry.isFile())
    .toSorted((a, b) =>
      path
        .join(a.parentPath, a.name)
        .localeCompare(path.join(b.parentPath, b.name))
    );
  if (entries.length > 100) {
    throw new Error("Preview build exceeds 100 files.");
  }
  const files: Buffer[] = [];
  const manifest: PreviewBuildManifest = { files: [] };
  let total = 0;
  for (const entry of entries) {
    // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
    const resolved = await realpath(path.join(entry.parentPath, entry.name));
    const relative = path
      .relative(actualRoot, resolved)
      .replaceAll(path.sep, "/");
    if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
      throw new Error("Preview file escapes the build output.");
    }
    // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
    const bytes = await readFile(resolved);
    if (bytes.length > 1024 * 1024) {
      throw new Error(`Preview file ${relative} exceeds 1 MiB.`);
    }
    total += bytes.length;
    if (total > 10 * 1024 * 1024) {
      throw new Error("Preview build exceeds 10 MiB.");
    }
    if (relative === "views.json") {
      manifest.views = previewBuildManifestSchema.shape.views
        .unwrap()
        .parse(JSON.parse(bytes.toString("utf-8")));
    }
    files.push(bytes);
    manifest.files.push({
      chunks: Math.ceil(bytes.length / chunkBytes),
      contentType:
        contentTypes[path.extname(relative)] ?? "application/octet-stream",
      path: relative,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    });
  }
  if (!manifest.files.some((file) => file.path === "client.js")) {
    throw new Error("Preview build is missing client.js.");
  }
  return {
    files,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex"),
    manifest,
  };
};

export const createLatestPreviewCapture = <T>(
  captureSnapshot: () => Promise<T>,
  onSnapshot: (snapshot: T) => void,
  onError: (error: unknown) => void
): (() => Promise<void>) => {
  let generation = 0;
  return async () => {
    generation += 1;
    const current = generation;
    try {
      const snapshot = await captureSnapshot();
      if (current === generation) {
        onSnapshot(snapshot);
      }
    } catch (error) {
      if (current === generation) {
        onError(error);
      }
    }
  };
};

export const uploadPreviewSnapshot = async (
  client: PreviewWebSocketClient,
  current: Snapshot
): Promise<void> => {
  const { buildId } = await client.beginBuild({ manifest: current.manifest });
  for (const [fileIndex, bytes] of current.files.entries()) {
    for (
      let chunkIndex = 0;
      chunkIndex < (current.manifest.files[fileIndex]?.chunks ?? 0);
      chunkIndex += 1
    ) {
      // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
      await client.uploadChunk({
        base64: bytes
          .subarray(chunkIndex * chunkBytes, (chunkIndex + 1) * chunkBytes)
          .toString("base64"),
        buildId,
        chunkIndex,
        fileIndex,
      });
    }
  }
  await client.commitBuild({ buildId });
};

const previewOptionsSchema = z.object({
  config: z.string().optional(),
  cwd: z.string().default("."),
  mode: z.string().optional(),
  outDir: z.string().optional(),
  replace: z.boolean().optional(),
});
export const toPreviewOptions = (
  options: Record<string, unknown>
): PreviewOptions => {
  const parsed = previewOptionsSchema.parse(options);
  return {
    configPath: parsed.config,
    cwd: parsed.cwd,
    mode: parsed.mode,
    outDir: parsed.outDir,
    replace: parsed.replace,
  };
};

export const runPreview = async (options: PreviewOptions): Promise<void> => {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);

  if (!loaded.config.appId) {
    throw new Error(
      "Missing appId. Deploy once before starting a remote preview."
    );
  }

  const auth = await runWhoami(options);

  const stored = await getDeployToken(auth.hostUrl);

  if (!stored?.deployToken) {
    throw new Error("Not logged in. Run tailorkit login first.");
  }
  const { result: watcher, outDir } = await buildProject({
    ...options,
    cwd: loaded.root,
    watch: true,
  });
  const closeWatcher = async (): Promise<void> => {
    if (watcher && typeof watcher === "object" && "close" in watcher) {
      await (watcher as { close: () => Promise<void> | void }).close();
    }
  };

  const client = createCliClient({
    token: stored.deployToken,
    url: auth.hostUrl,
  });

  const previewAppId = loaded.config.appId;
  const result = await (async () => {
    try {
      return await client.preview.start({
        appId: previewAppId,
        replaceActive: options.replace,
      });
    } catch (error) {
      await closeWatcher();
      throw error;
    }
  })();

  const data = "data" in result ? result.data : result;

  if (!data) {
    await closeWatcher();
    throw new Error("Unable to start preview session.");
  }

  const cleanupClient = createCliClient({
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    token: stored.deployToken,
    url: auth.hostUrl,
  });

  const stop = async () => {
    try {
      await cleanupClient.preview.stop({ sessionId: data.sessionId });
    } catch (error) {
      log.warn(`Unable to end preview session: ${errorMessage(error)}`);
    }
  };
  let root: string;

  let latest: Snapshot;

  try {
    root = await realpath(path.join(outDir, "client"));
    latest = await capturePreviewSnapshot(root);
  } catch (error) {
    try {
      await closeWatcher();
    } catch (closeError) {
      log.warn(`Unable to close preview watcher: ${errorMessage(closeError)}`);
    }
    await stop();
    throw error;
  }

  let uploadedFingerprint: string | undefined;

  let activeClient: PreviewWebSocketClient | undefined;

  let activeSocket: WebSocket | undefined;

  let closed = false;

  let uploading = false;

  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  let lastUploadStart = 0;

  let reconnectDelay = 1000;

  let connectionGeneration = 0;

  const handleSignal = () => {
    if (closed) {
      return;
    }
    closed = true;
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    void (async () => {
      try {
        return await closeWatcher();
      } catch (error) {
        log.warn(`Unable to close preview watcher: ${errorMessage(error)}`);
      }
    })();
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    activeSocket?.close();
    void (async () => {
      try {
        return await stop();
      } finally {
        process.exit(0);
      }
    })();
  };

  const endTerminalSession = () => {
    if (closed) {
      return;
    }
    closed = true;
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    activeSocket?.close();
    void (async () => {
      try {
        return await closeWatcher();
      } catch (error) {
        log.warn(`Unable to close preview watcher: ${errorMessage(error)}`);
      }
    })();
    log.warn("Preview session ended. Start a new preview to continue.");
  };

  const scheduleUpload = () => {
    if (closed || !activeClient || uploading) {
      return;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(
      () => {
        idleTimer = undefined;
        if (!activeClient || latest.fingerprint === uploadedFingerprint) {
          return;
        }
        const current = latest;
        const wsClient = activeClient;
        const generation = connectionGeneration;
        uploading = true;
        lastUploadStart = Date.now();
        void (async () => {
          try {
            return await (async () => {
              try {
                return await (async () => {
                  void (await uploadPreviewSnapshot(wsClient, current));
                  if (generation === connectionGeneration) {
                    uploadedFingerprint = current.fingerprint;
                  }
                })();
              } catch (error) {
                if (!closed) {
                  log.warn(
                    `Preview upload interrupted: ${errorMessage(error)}`
                  );
                }
              }
            })();
          } finally {
            if (generation === connectionGeneration) {
              uploading = false;
              if (latest.fingerprint !== uploadedFingerprint) {
                scheduleUpload();
              }
            }
          }
        })();
      },
      Math.max(500, 500 - (Date.now() - lastUploadStart))
    );
  };

  const capture = createLatestPreviewCapture(
    () => capturePreviewSnapshot(root),
    (snapshot) => {
      if (closed) {
        return;
      }
      latest = snapshot;
      scheduleUpload();
    },
    (err7) => {
      if (!closed) {
        log.warn(`Keeping the last successful preview: ${errorMessage(err7)}`);
      }
    }
  );

  if (watcher && typeof watcher === "object" && "on" in watcher) {
    (
      watcher as {
        on: (name: string, listener: (event: { code: string }) => void) => void;
      }
    ).on("event", (event: { code: string }) => {
      if (event.code === "BUNDLE_END") {
        void capture();
      }
    });
  }

  const connect = () => {
    if (closed) {
      return;
    }
    const url = new URL(data.tunnelUrl);
    url.searchParams.set("role", "uploader");
    const socket = new WebSocket(url, data.tunnelToken);
    activeSocket = socket;
    socket.addEventListener("open", () => {
      connectionGeneration += 1;
      reconnectDelay = 1000;
      activeClient = createPreviewWebSocketClient(socket);
      const sendHeartbeat = async () => {
        try {
          await activeClient?.heartbeat();
        } catch (error) {
          if (activeSocket !== socket || closed) {
            return;
          }
          if (isEndedSessionError(error)) {
            endTerminalSession();
          } else {
            socket.close();
          }
        }
      };
      sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, 20_000);
      scheduleUpload();
    });
    socket.addEventListener("close", () => {
      connectionGeneration += 1;
      uploading = false;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (activeSocket === socket) {
        activeSocket = undefined;
        activeClient = undefined;
      }
      if (!closed) {
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      }
    });
    socket.addEventListener("error", () => socket.close());
  };

  connect();

  process.once("SIGINT", handleSignal);

  process.once("SIGTERM", handleSignal);

  const shareUrl = new URL(loaded.config.host ?? auth.hostUrl);

  shareUrl.pathname = `${shareUrl.pathname.replace(/\/+$/u, "")}/preview/${data.shareId}`;

  log.info(pc.green(`Host preview: ${shareUrl.href}`));

  log.info(pc.dim(`Uploading built app assets from ${root}`));
};
