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

const mocks = vi.hoisted(() => ({
  nativeSandbox: vi.fn(),
  runCommand: vi.fn(),
}));
vi.mock("./utils", async (original) => ({
  ...(await original<typeof utilsModule>()),
  toolNativeSandbox: mocks.nativeSandbox,
}));
const context = {
  agentToken: "private-token",
  appId: "selected-app",
  sandboxName: "sandbox-one",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.nativeSandbox.mockResolvedValue({ runCommand: mocks.runCommand });
});

it("pins the authorized app and injects credentials only into the deploy process", async () => {
  mocks.runCommand.mockResolvedValue({
    exitCode: 0,
    stderr: vi.fn<() => Promise<string>>().mockResolvedValue(""),
    stdout: vi
      .fn<() => Promise<string>>()
      .mockResolvedValue("Deployment: published-one"),
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
      CI: "true",
      NO_COLOR: "1",
      TAILORKIT_AGENT_TOKEN: context.agentToken,
    },
  });
  expect(command.args.join(" ")).not.toContain(context.agentToken);
});

it("returns failures for the agent to address and redacts echoed credentials", async () => {
  mocks.runCommand.mockResolvedValue({
    exitCode: 1,
    stderr: vi
      .fn<() => Promise<string>>()
      .mockResolvedValue(`Rejected ${context.agentToken}`),
    stdout: vi
      .fn<() => Promise<string>>()
      .mockResolvedValue(context.agentToken),
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
