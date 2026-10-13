// oxlint-disable-next-line max-classes-per-file -- These related adapter or mock classes implement one runtime boundary.
import { APIError } from "@vercel/sandbox";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FatalError } from "workflow";

import {
  deleteSandbox,
  getSandbox,
  prepareSandbox,
  sandboxIdleTimeoutMs,
  writeAgentSchema,
  agentSchemaPath,
  agentTokenPath,
  writeAgentToken,
} from "./sandbox";

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  drive: vi.fn(),
  extend: vi.fn(),
  get: vi.fn(),
  getOrCreate: vi.fn(),
  runCommand: vi.fn(),
  writeFiles: vi.fn(),
}));
vi.mock("workflow", () => ({ FatalError: class extends Error {} }));
vi.mock("@vercel/sandbox", () => ({
  APIError: class extends Error {
    response: Response;
    constructor(response: Response, options?: { message: string }) {
      super(options?.message);
      this.response = response;
    }
  },
  Drive: { getOrCreate: mocks.drive },
  Sandbox: { get: mocks.get, getOrCreate: mocks.getOrCreate },
}));

const sandboxName = "app-agent-bob";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(300_000);
  mocks.drive.mockResolvedValue({ name: "app-123", region: "syd1" });
  mocks.getOrCreate.mockResolvedValue({ name: sandboxName });
  mocks.get.mockResolvedValue({
    currentSession: () => ({
      extendTimeout: mocks.extend,
      runCommand: mocks.runCommand,
      writeFiles: mocks.writeFiles,
    }),
    delete: mocks.delete,
    expiresAt: new Date(sandboxIdleTimeoutMs),
    name: sandboxName,
    status: "running",
  });
});

describe("sandbox ownership and sliding timeout", () => {
  it("mounts the persistent Drive on a disposable 15-minute sandbox without stopping it", async () => {
    await prepareSandbox("app-123", sandboxName);
    expect(mocks.getOrCreate).toHaveBeenCalledWith({
      env: { TAILORKIT_AGENT_TOKEN_FILE: agentTokenPath },
      image: "vercel/sandbox/universal",
      mounts: { "/workspace": expect.objectContaining({ name: "app-123" }) },
      name: sandboxName,
      persistent: false,
      region: "syd1",
      timeout: sandboxIdleTimeoutMs,
    });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("writes a supplied schema as JSON on the persistent Drive", async () => {
    const schema = {
      components: {},
      slots: {},
      tools: {},
      version: 1,
      views: {},
    };
    await writeAgentSchema(sandboxName, schema);
    expect(mocks.writeFiles).toHaveBeenCalledExactlyOnceWith([
      {
        content: Buffer.from(JSON.stringify(schema), "utf-8"),
        path: agentSchemaPath,
      },
    ]);
    expect(agentSchemaPath).toBe("/workspace/tailorkit.schema.json");
  });

  it("fails busy Drive requests immediately without touching the active writer", async () => {
    mocks.drive.mockResolvedValue({
      currentSandboxName: "app-agent-alice",
      name: "app-123",
    });
    const preparation = prepareSandbox("app-123", sandboxName);
    await expect(preparation).rejects.toBeInstanceOf(FatalError);
    await expect(preparation).rejects.toThrow("already being edited");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it("makes a racing mount rejection fatal instead of waiting through step retries", async () => {
    mocks.getOrCreate.mockRejectedValue(
      new APIError(new Response(null, { status: 409 }), {
        message: "Drive is already mounted",
      })
    );
    await expect(prepareSandbox("app-123", sandboxName)).rejects.toBeInstanceOf(
      FatalError
    );
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("extends only the missing five minutes when ten minutes remain", async () => {
    await getSandbox(sandboxName);
    expect(mocks.get).toHaveBeenCalledWith({ name: sandboxName });
    expect(mocks.extend).toHaveBeenCalledWith(300_000);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("does not accumulate another fifteen minutes when it already has fifteen remaining", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    await getSandbox(sandboxName);
    expect(mocks.extend).not.toHaveBeenCalled();
  });

  it("rejects expired or stopped VMs without resuming or recreating them", async () => {
    mocks.get.mockResolvedValueOnce({
      expiresAt: new Date(299_999),
      status: "running",
    });
    await expect(getSandbox(sandboxName)).rejects.toThrow("no longer running");
    mocks.get.mockResolvedValueOnce({ status: "stopped" });
    await expect(getSandbox(sandboxName)).rejects.toThrow("no longer running");
    expect(mocks.extend).not.toHaveBeenCalled();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it("deletes only the supplied sandbox and tolerates already-deleted metadata", async () => {
    await deleteSandbox(sandboxName);
    expect(mocks.get).toHaveBeenCalledWith({ name: sandboxName });
    expect(mocks.delete).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
    mocks.get.mockRejectedValue(
      new APIError(new Response(null, { status: 404 }))
    );
    await expect(deleteSandbox(sandboxName)).resolves.toBeUndefined();
  });
});

it("keeps the authorization file off the Drive and restricts its permissions", async () => {
  mocks.runCommand.mockResolvedValue({ exitCode: 0 });
  await writeAgentToken(sandboxName, "private-token");
  expect(mocks.writeFiles).toHaveBeenCalledWith([
    {
      content: Buffer.from("private-token"),
      path: "/tmp/tailorkit-agent.token",
    },
  ]);
  expect(mocks.runCommand).toHaveBeenCalledWith({
    args: ["600", agentTokenPath],
    cmd: "chmod",
    timeoutMs: 30_000,
  });
  expect(JSON.stringify(mocks.runCommand.mock.calls)).not.toContain(
    "private-token"
  );
});
