import { beforeEach, expect, it, vi } from "vite-plus/test";

import { deployTool } from "./deploy";

const mocks = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("./utils", async (original) => ({
  ...(await original<typeof import("./utils")>()),
  toolNativeSandbox: async () => ({ runCommand: mocks.runCommand }),
}));
const context = {
  agentToken: "private-token",
  appId: "selected-app",
  sandboxName: "sandbox-one",
};

beforeEach(() => {
  vi.resetAllMocks();
});

it("pins the authorized app and injects credentials only into the deploy process", async () => {
  mocks.runCommand.mockResolvedValue({
    exitCode: 0,
    stderr: async () => "",
    stdout: async () => "Deployment: published-one",
  });
  const result = await deployTool.execute!(
    {},
    { context, messages: [], toolCallId: "deploy-one" }
  );
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "Deployment: published-one",
  });
  const command = mocks.runCommand.mock.lastCall![0];
  expect(command).toMatchObject({
    args: [
      "--dir",
      "/tmp/tailorkit-cli",
      "exec",
      "tailorkit",
      "deploy",
      "--cwd",
      "/workspace/app",
      "--app-id",
      context.appId,
      "--no-interactive",
    ],
    cmd: "pnpm",
    env: {
      TAILORKIT_AGENT_TOKEN: context.agentToken,
    },
  });
  expect(command.args.join(" ")).not.toContain(context.agentToken);
});

it("returns failures for the agent to address and redacts echoed credentials", async () => {
  mocks.runCommand.mockResolvedValue({
    exitCode: 1,
    stderr: async () => `Rejected ${context.agentToken}`,
    stdout: async () => context.agentToken,
  });
  expect(
    await deployTool.execute!(
      {},
      { context, messages: [], toolCallId: "deploy-one" }
    )
  ).toEqual({
    exitCode: 1,
    stderr: "Rejected [redacted]",
    stdout: "[redacted]",
  });
});

it("redacts credentials from command transport failures", async () => {
  mocks.runCommand.mockRejectedValue(
    new Error(`Command failed: ${context.agentToken}`)
  );
  expect(
    await deployTool.execute!(
      {},
      { context, messages: [], toolCallId: "deploy-one" }
    )
  ).toEqual({
    exitCode: 1,
    stderr: "Command failed: [redacted]",
    stdout: "",
  });
});
