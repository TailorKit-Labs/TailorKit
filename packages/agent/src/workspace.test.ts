import { beforeEach, expect, it, vi } from "vite-plus/test";

import type { AppAgentInput } from "./input";
import { prepareWorkspace } from "./workspace";

const input: AppAgentInput = {
  agentToken: "private-token",
  appId: "app-1",
  hostUrl: "https://host.test/api/tailorkit",
  messages: [{ content: "Build", role: "user" }],
  model: "xiaomi/mimo-v2.6-pro",
  threadId: "thread-1",
};

const session = {
  readFileToBuffer: vi.fn(),
  runCommand: vi.fn(),
  writeFiles: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  session.readFileToBuffer.mockResolvedValue(null);
  session.runCommand.mockResolvedValue({ exitCode: 0 });
});

it("prepares a matching beta CLI and app with only TailorKit exempt from release age", async () => {
  await prepareWorkspace(session, input);
  expect(session.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      args: ["add", "--save-exact", "tailorkit@beta"],
      cwd: "/tmp/tailorkit-cli",
    })
  );
  for (const path of [
    "/tmp/tailorkit-cli/pnpm-workspace.yaml",
    "/workspace/.tailorkit-scaffold/new-app/pnpm-workspace.yaml",
  ]) {
    expect(session.writeFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          content: Buffer.from(
            'minimumReleaseAge: 4320\nminimumReleaseAgeStrict: true\nminimumReleaseAgeExclude:\n  - tailorkit\n  - "@tailorkit/*"\n# The platform-specific esbuild binary is installed as an optional dependency.\nallowBuilds:\n  esbuild: false\n'
          ),
          path,
        },
      ])
    );
  }
  expect(session.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      args: ["-T", "/workspace/.tailorkit-scaffold/new-app", "/workspace/app"],
      cmd: "mv",
    })
  );
});

it("preserves existing app files, dependencies and host identity", async () => {
  session.readFileToBuffer.mockResolvedValueOnce(
    Buffer.from(
      '{"name":"existing","dependencies":{"tailorkit":"0.1.0-beta.28"}}'
    )
  );
  await prepareWorkspace(session, input);
  expect(session.runCommand).toHaveBeenCalledOnce();
  expect(session.writeFiles).toHaveBeenCalledExactlyOnceWith([
    {
      content: Buffer.from('{"private":true}'),
      path: "/tmp/tailorkit-cli/package.json",
    },
    {
      content: Buffer.from(
        'minimumReleaseAge: 4320\nminimumReleaseAgeStrict: true\nminimumReleaseAgeExclude:\n  - tailorkit\n  - "@tailorkit/*"\n# The platform-specific esbuild binary is installed as an optional dependency.\nallowBuilds:\n  esbuild: false\n'
      ),
      path: "/tmp/tailorkit-cli/pnpm-workspace.yaml",
    },
  ]);
});

it("reuses the installed CLI for a completed app without package installation", async () => {
  session.readFileToBuffer
    .mockResolvedValueOnce(Buffer.from('{"name":"existing"}'))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(Buffer.from("#!/bin/sh\n"));
  await prepareWorkspace(session, input);
  expect(session.readFileToBuffer).toHaveBeenNthCalledWith(2, {
    path: "/workspace/app/.tailorkit-setup-pending",
  });
  expect(session.readFileToBuffer).toHaveBeenNthCalledWith(3, {
    path: "/tmp/tailorkit-cli/node_modules/.bin/tailorkit",
  });
  expect(session.runCommand).not.toHaveBeenCalled();
  expect(session.writeFiles).not.toHaveBeenCalled();
});

it("fails preparation when a completed app's missing CLI cannot be installed", async () => {
  session.readFileToBuffer.mockResolvedValueOnce(
    Buffer.from('{"name":"existing"}')
  );
  session.runCommand.mockResolvedValueOnce({
    exitCode: 1,
    stderr: vi.fn().mockResolvedValue("Registry unavailable"),
  });
  await expect(prepareWorkspace(session, input)).rejects.toThrow(
    "TailorKit CLI installation failed: Registry unavailable"
  );
  expect(session.runCommand).toHaveBeenCalledExactlyOnceWith({
    args: ["add", "--save-exact", "tailorkit@beta"],
    cmd: "pnpm",
    cwd: "/tmp/tailorkit-cli",
    env: { CI: "true" },
    timeoutMs: 5 * 60_000,
  });
});

it("passes the supplied schema to both scaffolding and generation without shell interpolation", async () => {
  const hostUrl =
    "https://host.test/api/tailorkit?value=$(touch /tmp/injected)";
  const schemaPath = "/workspace/tailorkit.schema.json";
  await prepareWorkspace(session, { ...input, hostUrl }, schemaPath);
  expect(session.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      args: [
        "exec",
        "tailorkit",
        "init",
        "/workspace/.tailorkit-scaffold",
        "--name",
        "new-app",
        "--host",
        hostUrl,
        "--schema",
        schemaPath,
        "--package-manager",
        "pnpm",
        "--tooling",
        "vite-plus",
        "--no-install",
      ],
      cmd: "pnpm",
    })
  );
  expect(session.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      args: ["run", "generate", "--schema", schemaPath],
      cmd: "pnpm",
    })
  );
});

it.each(["init", "install", "generate"])(
  "keeps failed %s setup pending and redacts authorization",
  async (command) => {
    session.runCommand.mockImplementation(
      // oxlint-disable-next-line require-await -- Preserve the sandbox API's Promise-based command completion in this failure fixture.
      async ({ args }: { args: string[] }) => ({
        exitCode: args.includes(command) ? 1 : 0,
        stderr: vi.fn().mockResolvedValue(`Failure ${input.agentToken}`),
      })
    );
    await expect(prepareWorkspace(session, input)).rejects.toThrow(
      "Failure [redacted]"
    );
    expect(session.runCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["-f", "/workspace/app/.tailorkit-setup-pending"],
        cmd: "rm",
      })
    );
  }
);

it("finishes an interrupted install without overwriting the scaffold", async () => {
  session.readFileToBuffer
    .mockResolvedValueOnce(Buffer.from('{"name":"new-app"}'))
    .mockResolvedValueOnce(Buffer.from("Setup pending"));
  await prepareWorkspace(session, input);
  expect(session.runCommand).not.toHaveBeenCalledWith(
    expect.objectContaining({ cmd: "mv" })
  );
  expect(session.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["install"], cwd: "/workspace/app" })
  );
  expect(session.runCommand).toHaveBeenLastCalledWith(
    expect.objectContaining({
      args: ["-f", "/workspace/app/.tailorkit-setup-pending"],
      cmd: "rm",
    })
  );
});
