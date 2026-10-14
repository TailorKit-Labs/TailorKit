/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-member-access, typescript/no-unsafe-call -- This integration fixture loads workspace or generated modules dynamically and supplies minimal platform doubles; its assertions validate the observed runtime contract. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  beginBuild: vi.fn(),
  build: vi.fn(),
  client: vi.fn(),
  close: vi.fn(),
  commitBuild: vi.fn(),
  heartbeat: vi.fn(),
  load: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  token: vi.fn(),
  uploadChunk: vi.fn(),
  whoami: vi.fn(),
}));

vi.mock("@tailorkit/vite/config/loader", () => ({
  loadTailorKitConfig: mocks.load,
}));
vi.mock("./build", () => ({ buildProject: mocks.build }));
vi.mock("@tailorkit/core/server", () => ({
  createTailorKitClient: mocks.client,
}));
vi.mock("@tailorkit/client-platform/preview", () => ({
  createPreviewWebSocketClient: () => ({
    beginBuild: mocks.beginBuild,
    commitBuild: mocks.commitBuild,
    heartbeat: mocks.heartbeat,
    uploadChunk: mocks.uploadChunk,
  }),
}));
vi.mock("./auth", () => ({
  getDeployToken: mocks.token,
  runWhoami: mocks.whoami,
}));

const { runPreview } = await import("./preview");
const dirs: string[] = [];
interface SignalListeners {
  SIGINT: ReturnType<typeof process.listeners>;
  SIGTERM: ReturnType<typeof process.listeners>;
}
let signalListeners: SignalListeners;

beforeEach(() => {
  signalListeners = {
    SIGINT: process.listeners("SIGINT"),
    SIGTERM: process.listeners("SIGTERM"),
  };
  vi.resetAllMocks();
  // oxlint-disable-next-line require-await -- The mock keeps the asynchronous API contract.
  mocks.build.mockImplementation(async (options) => ({
    outDir: path.resolve(options.cwd, options.outDir ?? ".tailorkit"),
    result: { close: mocks.close },
  }));
  mocks.close.mockImplementation(async () => {});
  mocks.client.mockReturnValue({
    preview: { start: mocks.start, stop: mocks.stop },
  });
  mocks.start.mockResolvedValue({ data: { sessionId: "session" } });
  mocks.stop.mockImplementation(async () => {});
  mocks.token.mockResolvedValue({ deployToken: "token" });
  mocks.whoami.mockResolvedValue({ hostUrl: "https://host.test" });
  mocks.heartbeat.mockResolvedValue({ accepted: true });
  mocks.beginBuild.mockResolvedValue({ buildId: "build" });
  mocks.uploadChunk.mockResolvedValue({ accepted: true });
  mocks.commitBuild.mockResolvedValue({ accepted: true });
});

it.each([
  "Preview session is unavailable.",
  "Preview CLI token is unavailable.",
])("stops reconnecting when heartbeat reports %s", async (message) => {
  class PreviewSocket extends EventTarget {
    static instances: PreviewSocket[] = [];
    closed = false;
    constructor(_url: URL, _protocol: string) {
      super();
      PreviewSocket.instances.push(this);
    }
    close() {
      this.closed = true;
      this.dispatchEvent(new Event("close"));
    }
    open() {
      this.dispatchEvent(new Event("open"));
    }
  }
  vi.stubGlobal("WebSocket", PreviewSocket);
  const cwd = await mkdtemp(path.join(tmpdir(), "tailorkit-preview-terminal-"));
  dirs.push(cwd);
  await mkdir(path.join(cwd, "output/client"), { recursive: true });
  await writeFile(
    path.join(cwd, "output/client/client.js"),
    "export default 1"
  );
  await mkdir(path.join(cwd, "output/server"));
  await writeFile(path.join(cwd, "output/server/server.js"), "PRIVATE SERVER");
  await mkdir(path.join(cwd, "output/migrations"));
  await writeFile(
    path.join(cwd, "output/migrations/migration.sql"),
    "PRIVATE MIGRATION"
  );
  mocks.load.mockResolvedValue({ config: { appId: "app" }, root: cwd });
  mocks.start.mockResolvedValue({
    data: {
      sessionId: "session",
      shareId: "share",
      tunnelToken: "token",
      tunnelUrl: "wss://platform.test/preview",
    },
  });
  // End the session after the first upload so its manifest can be inspected.
  const heartbeat = Promise.withResolvers<{ accepted: boolean }>();
  mocks.heartbeat.mockReturnValue(heartbeat.promise);
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  mocks.commitBuild.mockImplementation(async () => {
    heartbeat.reject({ code: "UNAUTHORIZED", message });
    return { accepted: true };
  });

  await runPreview({ cwd, outDir: "output" });
  const [socket] = PreviewSocket.instances;
  socket?.open();
  await vi.waitFor(() => {
    expect(mocks.commitBuild).toHaveBeenCalledOnce();
  });
  expect(
    mocks.beginBuild.mock.calls[0]?.[0].manifest.files.map(
      (file: { path: string }) => file.path
    )
  ).toEqual(["client.js"]);
  await vi.waitFor(() => {
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  expect(socket?.closed).toBe(true);
  expect(process.listeners("SIGINT")).toEqual(signalListeners.SIGINT);
  expect(process.listeners("SIGTERM")).toEqual(signalListeners.SIGTERM);
  await (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers();
    try {
      setTimeout(resolve, 1100);
    } catch (error) {
      rejectPending(error);
    }
    return await pendingPromise;
  })();
  expect(PreviewSocket.instances).toHaveLength(1);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].includes(listener)) {
        process.off(signal, listener);
      }
    }
  }
  await Promise.all(
    dirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    })
  );
});

it.each([
  ["output resolution", false, /ENOENT/u],
  ["initial snapshot validation", true, /missing client\.js/u],
])("cleans up after %s fails", async (_case, createOutput, expected) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tailorkit-preview-startup-"));
  dirs.push(cwd);
  if (createOutput) {
    await mkdir(path.join(cwd, "output/client"), { recursive: true });
  }
  mocks.load.mockResolvedValue({ config: { appId: "app" }, root: cwd });

  await expect(runPreview({ cwd, outDir: "output" })).rejects.toThrow(expected);
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledWith({ sessionId: "session" });
  const closeOrder = mocks.close.mock.invocationCallOrder[0] ?? Infinity;
  const stopOrder = mocks.stop.mock.invocationCallOrder[0] ?? -Infinity;
  expect(closeOrder).toBeLessThan(stopOrder);
});
