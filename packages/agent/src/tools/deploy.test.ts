import { expect, it } from "vite-plus/test";

import { createDeployTool } from "./deploy";
import type { DeploymentSandbox } from "./deploy";

const context = {
  agentToken: "private-token",
  appId: "selected-app",
  sandboxName: "sandbox-one",
};
const execute = async (
  dependencies: Parameters<typeof createDeployTool>[0]
) => {
  const tool = createDeployTool(dependencies);
  if (tool.execute === undefined) {
    throw new Error("Missing deploy implementation.");
  }
  return await tool.execute(
    {},
    { context, messages: [], toolCallId: "deploy-one" }
  );
};
const commandResult = (exitCode = 0, stdout = "", stderr = "") => ({
  exitCode,
  stderr: async () => await Promise.resolve(stderr),
  stdout: async () => await Promise.resolve(stdout),
});

it("builds without credentials and publishes through the authorized host capability", async () => {
  const commands: Parameters<DeploymentSandbox["runCommand"]>[0][] = [];
  let published = false;
  const sandbox: DeploymentSandbox = {
    readFileToBuffer: async () => await Promise.resolve(null),
    runCommand: async (command) => {
      commands.push(command);
      return await Promise.resolve(commandResult());
    },
  };
  expect(
    await execute({
      publish: async (reader, authorization) => {
        expect(reader).toBe(sandbox);
        expect(authorization).toEqual(context);
        expect(commands.map((command) => command.args)).toEqual([
          ["exec", "tsc", "--noEmit"],
          [
            "exec",
            "node",
            "--input-type=module",
            "--eval",
            'import { build } from "vite"; await build({ build: { outDir: "/tmp/patchsmith-deployment" } });',
          ],
        ]);
        published = true;
        return await Promise.resolve("Deployment: published-one");
      },
      sandbox: async () => await Promise.resolve(sandbox),
    })
  ).toEqual({ exitCode: 0, stderr: "", stdout: "Deployment: published-one" });
  expect(published).toBe(true);
  for (const command of commands) {
    expect(command.env).toEqual({ CI: "true", NO_COLOR: "1" });
    expect(JSON.stringify(command)).not.toContain(context.agentToken);
    expect(JSON.stringify(command)).not.toContain("PATCHSMITH_AGENT_TOKEN");
  }
});

it.each([0, 1])(
  "does not publish after preparation command %s fails",
  async (failedCommand) => {
    let commands = 0;
    let published = false;
    const result = await execute({
      publish: async () => {
        published = true;
        return await Promise.resolve("unexpected");
      },
      sandbox: async () =>
        await Promise.resolve({
          readFileToBuffer: async () => await Promise.resolve(null),
          runCommand: async () => {
            const failed = commands === failedCommand;
            commands += 1;
            return await Promise.resolve(
              commandResult(
                failed ? 1 : 0,
                context.agentToken,
                `Rejected ${context.agentToken}`
              )
            );
          },
        }),
    });
    expect(result).toEqual({
      exitCode: 1,
      stderr: "Rejected [redacted]",
      stdout: "[redacted]",
    });
    expect(published).toBe(false);
    expect(commands).toBe(failedCommand + 1);
  }
);

it("redacts publication transport failures", async () => {
  expect(
    await execute({
      publish: async () =>
        await Promise.reject(
          new Error(`Publication failed: ${context.agentToken}`)
        ),
      sandbox: async () =>
        await Promise.resolve({
          readFileToBuffer: async () => await Promise.resolve(null),
          runCommand: async () => await Promise.resolve(commandResult()),
        }),
    })
  ).toEqual({
    exitCode: 1,
    stderr: "Publication failed: [redacted]",
    stdout: "",
  });
});
