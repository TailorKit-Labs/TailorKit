import { expect, it } from "vite-plus/test";

import { createDeployTool } from "./deploy";
import type { AppSandboxSession } from "./sandbox-session";

const agentToken = "scoped-agent-grant";
const context = { agentToken, sandboxName: "app-sandbox" };
const checkArguments = [
  ["run", "format:fix"],
  ["run", "check"],
  ["run", "test", "--passWithNoTests"],
];

it.each([
  { exitCode: 0, stderr: "", stdout: "Deployment: published-version" },
  {
    exitCode: 2,
    stderr: `Authorization rejected: ${agentToken}`,
    stdout: `Build diagnostics: ${agentToken}`,
  },
])(
  "returns CLI output and exit code $exitCode with credentials redacted",
  async (output) => {
    const commands: Parameters<AppSandboxSession["runCommand"]>[0][] = [];
    const controller = new AbortController();
    const tool = createDeployTool({
      sandbox: async (name) => {
        expect(name).toBe(context.sandboxName);
        return await Promise.resolve({
          runCommand: async (command) => {
            commands.push(command);
            const deploying = command.args?.[0] === "exec";
            return await Promise.resolve({
              exitCode: deploying ? output.exitCode : 0,
              stderr: async () =>
                await Promise.resolve(deploying ? output.stderr : ""),
              stdout: async () =>
                await Promise.resolve(deploying ? output.stdout : ""),
            });
          },
        });
      },
    });
    const result = await tool.execute(
      {},
      {
        abortSignal: controller.signal,
        context,
        messages: [],
        toolCallId: "deploy",
      }
    );
    expect(commands).toEqual(
      [
        ...checkArguments,
        ["exec", "tailorkit", "deploy", "--no-interactive"],
      ].map((args) => ({
        args,
        cmd: "pnpm",
        cwd: "/workspace/app",
        env: { CI: "true", NO_COLOR: "1", TAILORKIT_AGENT_TOKEN: agentToken },
        signal: controller.signal,
        timeoutMs: 5 * 60_000,
      }))
    );
    expect(result).toEqual({
      exitCode: output.exitCode,
      stderr: output.stderr.replaceAll(agentToken, "[redacted]"),
      stdout: output.stdout.replaceAll(agentToken, "[redacted]"),
    });
    expect(JSON.stringify(result)).not.toContain(agentToken);
  }
);

it.each([0, 1, 2])(
  "stops before publication when check %i fails",
  async (failedCheck) => {
    const commands: string[][] = [];
    const tool = createDeployTool({
      sandbox: async () =>
        await Promise.resolve({
          runCommand: async ({ args = [] }) => {
            commands.push(args);
            const failed = commands.length === failedCheck + 1;
            return await Promise.resolve({
              exitCode: failed ? 2 : 0,
              stderr: async () =>
                await Promise.resolve(failed ? `Fix ${agentToken}` : ""),
              stdout: async () => await Promise.resolve(`${args.join(" ")}\n`),
            });
          },
        }),
    });
    const result = await tool.execute(
      {},
      { context, messages: [], toolCallId: "deploy" }
    );
    expect(commands).toEqual(checkArguments.slice(0, failedCheck + 1));
    expect(result).toEqual({
      exitCode: 2,
      stderr: "Fix [redacted]",
      stdout: commands.map((args) => `${args.join(" ")}\n`).join(""),
    });
  }
);

it.each(["sandbox", "command"])(
  "reports %s failures without exposing authorization",
  async (failure) => {
    const error = new Error(`Could not deploy: ${agentToken}`);
    const tool = createDeployTool({
      sandbox: async () => {
        if (failure === "sandbox") {
          throw error;
        }
        return await Promise.resolve({
          runCommand: () => {
            throw error;
          },
        });
      },
    });
    expect(
      await tool.execute(
        {},
        {
          context,
          messages: [],
          toolCallId: "deploy",
        }
      )
    ).toEqual({
      exitCode: 1,
      stderr: "Could not deploy: [redacted]",
      stdout: "",
    });
  }
);
