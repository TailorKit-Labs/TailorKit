import { expect, it } from "vite-plus/test";

import type { AppAgentInput } from "./input";
import type { AppSandboxSession } from "./sandbox-session";
import { hostSchemaPath, prepareWorkspace } from "./workspace";

const input: AppAgentInput = {
  agentToken: "private-token",
  appId: "app",
  hostUrl: "https://host.test/api/tailorkit",
  messages: [{ content: "Build", role: "user" }],
  model: "openai/gpt-6.1-sol",
  threadId: "thread",
};

const workspace = () => {
  const files = new Map<string, Buffer>();
  const commands: Parameters<AppSandboxSession["runCommand"]>[0][] = [];
  const state = { failInstall: false, partialSource: false };
  const session: AppSandboxSession = {
    readFileToBuffer: async ({ path }) =>
      await Promise.resolve(files.get(path) ?? null),
    runCommand: async (command) => {
      commands.push(command);
      const args = command.args ?? [];
      const failedInstall =
        command.cmd === "pnpm" && args[0] === "install" && state.failInstall;
      const refusedMove = command.cmd === "mv" && state.partialSource;
      if (command.cmd === "mv" && !refusedMove) {
        files.set("/workspace/app/package.json", Buffer.from('{"name":"app"}'));
        files.set(
          "/workspace/app/.tailorkit-setup-pending",
          Buffer.from("pending")
        );
      }
      if (command.cmd === "rm" && args[0] === "-f") {
        files.delete("/workspace/app/.tailorkit-setup-pending");
      }
      return await Promise.resolve({
        exitCode: failedInstall || refusedMove ? 1 : 0,
        stderr: async () => await Promise.resolve(`Failed ${input.agentToken}`),
        stdout: async () => await Promise.resolve(""),
      });
    },
    writeFiles: async (entries) => {
      for (const entry of entries) {
        files.set(entry.path, Buffer.from(entry.content));
      }
      await Promise.resolve();
    },
  };
  return { commands, files, session, state };
};

it("prepares a bare app and preserves a supplied schema without model setup calls", async () => {
  const fixture = workspace();
  await prepareWorkspace(fixture.session, { ...input, schema: { version: 1 } });
  const scaffold = fixture.commands.find(
    (command) => command.args?.[0] === "dlx"
  );
  expect(scaffold?.args).toEqual([
    "dlx",
    "tailorkit@beta",
    "init",
    "/workspace/.tailorkit-scaffold",
    "--name",
    "app",
    "--host",
    input.hostUrl,
    "--schema",
    hostSchemaPath,
    "--package-manager",
    "pnpm",
    "--tooling",
    "vite-plus",
    "--bare",
    "--no-install",
  ]);
  expect(
    fixture.commands.some(
      (command) => command.args?.includes("generate") === true
    )
  ).toBe(false);
  expect(fixture.files.has("/workspace/app/.tailorkit-setup-pending")).toBe(
    false
  );
  for (const command of fixture.commands) {
    expect(JSON.stringify(command)).not.toContain(input.agentToken);
  }
});

it("preserves an existing app without reinstalling or regenerating it", async () => {
  const fixture = workspace();
  fixture.files.set(
    "/workspace/app/package.json",
    Buffer.from('{"name":"existing"}')
  );
  await prepareWorkspace(fixture.session, input);
  expect(fixture.commands).toEqual([]);
});

it("resumes an interrupted install without replacing source or scaffolding twice", async () => {
  const fixture = workspace();
  fixture.state.failInstall = true;
  await expect(prepareWorkspace(fixture.session, input)).rejects.toThrow(
    "Failed [redacted]"
  );
  expect(fixture.files.has("/workspace/app/.tailorkit-setup-pending")).toBe(
    true
  );
  fixture.commands.length = 0;
  fixture.state.failInstall = false;
  await prepareWorkspace(fixture.session, input);
  expect(fixture.commands.map((command) => command.cmd)).toEqual([
    "pnpm",
    "rm",
  ]);
  expect(fixture.files.has("/workspace/app/.tailorkit-setup-pending")).toBe(
    false
  );
});

it("does not install over source that has no package manifest", async () => {
  const fixture = workspace();
  fixture.state.partialSource = true;
  await expect(prepareWorkspace(fixture.session, input)).rejects.toThrow(
    "App workspace creation failed"
  );
  expect(
    fixture.commands.some((command) => command.args?.[0] === "install")
  ).toBe(false);
});
