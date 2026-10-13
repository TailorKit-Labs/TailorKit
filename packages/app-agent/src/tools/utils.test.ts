import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toolNativeSandbox, toolSandbox } from "./utils";

const mocks = vi.hoisted(() => ({
  getSandbox: vi.fn(),
  read: vi.fn(),
  runCommand: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../sandbox", () => ({
  getSandbox: mocks.getSandbox,
  sandboxIdleTimeoutMs: 15 * 60_000,
}));
vi.mock("workflow", () => ({ FatalError: class extends Error {} }));

const session = {
  readFileToBuffer: mocks.read,
  runCommand: mocks.runCommand,
  writeFiles: mocks.write,
};
const options = {
  context: { sandboxName: "app-agent-run-1" },
  messages: [],
  toolCallId: "call-1",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSandbox.mockResolvedValue({ currentSession: () => session });
  mocks.runCommand.mockResolvedValue({
    exitCode: 0,
    stderr: () => Promise.resolve(""),
    stdout: () => Promise.resolve("ok"),
  });
});

describe("pinned tool session", () => {
  it("retrieves/renews the sandbox but returns the existing VM for tool operations", async () => {
    expect(await toolNativeSandbox(options)).toBe(session);
    expect(mocks.getSandbox).toHaveBeenCalledWith(options.context.sandboxName);
  });

  it("runs commands on the pinned VM with a process timeout", async () => {
    const sandbox = await toolSandbox(options);
    expect(
      await sandbox.run({ command: "pwd", workingDirectory: "/workspace/app" })
    ).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "ok",
    });
    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["-c", "pwd"],
        cmd: "bash",
        cwd: "/workspace/app",
        timeoutMs: 15 * 60_000,
      })
    );
  });

  it("preserves full text, supports inclusive line ranges and returns null for missing files", async () => {
    const sandbox = await toolSandbox(options);
    mocks.read.mockResolvedValue(Buffer.from("one\ntwo\nthree\n"));
    expect(
      await sandbox.readTextFile({ path: "/workspace/app/test.txt" })
    ).toBe("one\ntwo\nthree\n");
    expect(
      await sandbox.readTextFile({
        endLine: 3,
        path: "/workspace/app/test.txt",
        startLine: 2,
      })
    ).toBe("two\nthree");
    mocks.read.mockResolvedValue(null);
    expect(await sandbox.readTextFile({ path: "/missing" })).toBeNull();
  });

  it("creates parent directories and writes on the same pinned VM", async () => {
    const sandbox = await toolSandbox(options);
    await sandbox.writeTextFile({
      content: "hello",
      path: "/workspace/app/src/test.ts",
    });
    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["-p", "/workspace/app/src"],
        cmd: "mkdir",
      })
    );
    expect(mocks.write).toHaveBeenCalledWith(
      [{ content: Buffer.from("hello"), path: "/workspace/app/src/test.ts" }],
      expect.anything()
    );
    expect(mocks.getSandbox).toHaveBeenCalledTimes(1);
  });
});
