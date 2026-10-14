/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Vitest mock call records and asymmetric matchers intentionally erase types; this fixture uses partial doubles and checks their values in assertions. */
import { beforeEach, expect, it, vi } from "vite-plus/test";

import { deployTool } from "./deploy";
import type * as utilsModule from "./utils";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const mocks = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("./utils", async (original) => ({
  ...(await original<typeof utilsModule>()),
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
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
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    stderr: async () => "",
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    stdout: async () => "Deployment: published-one",
  });
  const result = await requireValue(deployTool.execute)(
    {},
    { context, messages: [], toolCallId: "deploy-one" }
  );
  expect(result).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "Deployment: published-one",
  });
  const [command] = requireValue(mocks.runCommand.mock.lastCall);
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
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    stderr: async () => `Rejected ${context.agentToken}`,
    // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
    stdout: async () => context.agentToken,
  });
  expect(
    await requireValue(deployTool.execute)(
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
    await requireValue(deployTool.execute)(
      {},
      { context, messages: [], toolCallId: "deploy-one" }
    )
  ).toEqual({
    exitCode: 1,
    stderr: "Command failed: [redacted]",
    stdout: "",
  });
});
