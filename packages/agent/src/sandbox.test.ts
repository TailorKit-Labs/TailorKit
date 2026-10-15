import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AppAgentInput } from "./input";
import {
  getSandbox,
  networkSession,
  prepareSandboxStep,
  stopSandboxStep,
} from "./sandbox";

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  drive: vi.fn(),
  extend: vi.fn(),
  get: vi.fn(),
  run: vi.fn(),
  stop: vi.fn(),
  workspace: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@vercel/sandbox", () => ({
  APIError: class extends Error {},
  Drive: { getOrCreate: mocks.drive },
  Sandbox: { get: mocks.get, getOrCreate: mocks.create },
}));
vi.mock("@ai-sdk/sandbox-vercel", () => ({
  createVercelNetworkSandboxSessionFromNativeSandbox: mocks.adapter,
}));
vi.mock("./workspace", () => ({ prepareWorkspace: mocks.workspace }));

const input: AppAgentInput = {
  agentToken: "private-token",
  appId: "app-1",
  hostUrl: "https://host.test/api/tailorkit",
  messages: [{ content: "Build", role: "user" }],
  model: "xiaomi/mimo-v2.6-pro",
  threadId: "thread-1",
};
const sandboxName = "agent-thread-thread-1";
const resumeFrom = {
  data: {},
  harnessId: "pi",
  specificationVersion: "harness-v1" as const,
  type: "resume-session" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  const sandbox = {
    currentSession: () => ({
      extendTimeout: mocks.extend,
      runCommand: mocks.run,
      writeFiles: mocks.write,
    }),
    delete: mocks.delete,
    expiresAt: new Date(Date.now() + 900_000),
    stop: mocks.stop,
  };
  mocks.get.mockResolvedValue(sandbox);
  mocks.create.mockResolvedValue(sandbox);
  mocks.drive.mockResolvedValue({ region: "iad1" });
  mocks.adapter.mockReturnValue({
    defaultWorkingDirectory: "/vercel/sandbox",
    restricted: () => ({}),
  });
  mocks.run.mockResolvedValue({ exitCode: 0 });
});

describe("Pi sandbox ownership", () => {
  it("creates a persistent app VM without exposing CLI authorization", async () => {
    await prepareSandboxStep(input, {});
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mounts: { "/workspace": { region: "iad1" } },
        name: sandboxName,
        persistent: true,
      })
    );
    expect(mocks.create.mock.calls[0]?.[0]).not.toHaveProperty("ports");
    expect(mocks.create.mock.calls[0]?.[0]).not.toHaveProperty("env");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith({
      args: ["-f", "/tmp/tailorkit-agent.token"],
      cmd: "rm",
      timeoutMs: 30_000,
    });
    expect(mocks.workspace).toHaveBeenCalledWith(
      expect.any(Object),
      input,
      undefined
    );
    expect(mocks.run.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.workspace.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("uses separate thread VMs with the same app source Drive", async () => {
    await prepareSandboxStep(input, {});
    await prepareSandboxStep({ ...input, threadId: "thread-2" }, {});
    expect(mocks.drive).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "app-app-1" })
    );
    expect(mocks.drive).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "app-app-1" })
    );
    expect(mocks.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "agent-thread-thread-1" })
    );
    expect(mocks.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "agent-thread-thread-2" })
    );
  });

  it("writes supplied host contracts before preparing the app", async () => {
    const schema = {
      components: {},
      slots: {},
      tools: {},
      version: 1 as const,
      views: {},
    };
    await prepareSandboxStep({ ...input, schema }, {});
    expect(mocks.write).toHaveBeenLastCalledWith([
      {
        content: Buffer.from(JSON.stringify(schema)),
        path: "/workspace/tailorkit.schema.json",
      },
    ]);
    expect(mocks.workspace).toHaveBeenCalledWith(
      expect.any(Object),
      { ...input, schema },
      "/workspace/tailorkit.schema.json"
    );
    expect(mocks.write.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.workspace.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("reattaches the same sandbox for the next native conversation turn", async () => {
    await prepareSandboxStep(input, { resumeFrom, sandboxName });
    expect(mocks.get).toHaveBeenCalledWith({ name: sandboxName, resume: true });
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.drive).not.toHaveBeenCalled();
  });

  it("fails a missing saved sandbox instead of starting an empty conversation", async () => {
    mocks.get.mockRejectedValueOnce(new Error("Snapshot missing"));
    await expect(
      prepareSandboxStep(input, { resumeFrom, sandboxName })
    ).rejects.toThrow("Snapshot missing");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an app Drive owned by another editor", async () => {
    mocks.drive.mockResolvedValueOnce({
      currentSandboxName: "another-run",
      region: "iad1",
    });
    await expect(prepareSandboxStep(input, {})).rejects.toThrow(
      "already being edited"
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("removes ephemeral CLI authorization before saving the idle snapshot", async () => {
    await stopSandboxStep(sandboxName);
    expect(mocks.run).toHaveBeenCalledWith({
      args: ["-f", "/tmp/tailorkit-agent.token"],
      cmd: "rm",
      timeoutMs: 30_000,
    });
    expect(mocks.run.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stop.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("sets the harness working directory without losing the network adapter methods", async () => {
    const sandbox = await getSandbox(sandboxName);
    const session = await networkSession(sandbox);
    expect(session.defaultWorkingDirectory).toBe("/workspace/app");
    expect(session.restricted()).toEqual({});
  });
});
