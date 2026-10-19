import { expect, it } from "vite-plus/test";

import { createDeployTool } from "./deploy";
import type { AppSandboxSession } from "./sandbox-session";

const agentToken = "scoped-agent-grant";
const context = { agentToken, sandboxName: "app-sandbox" };

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
            return await Promise.resolve({
              exitCode: output.exitCode,
              stderr: async () => await Promise.resolve(output.stderr),
              stdout: async () => await Promise.resolve(output.stdout),
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
    expect(commands).toEqual([
      {
        args: ["exec", "tailorkit", "deploy", "--no-interactive"],
        cmd: "pnpm",
        cwd: "/workspace/app",
        env: { CI: "true", NO_COLOR: "1", TAILORKIT_AGENT_TOKEN: agentToken },
        signal: controller.signal,
        timeoutMs: 5 * 60_000,
      },
    ]);
    expect(result).toEqual({
      exitCode: output.exitCode,
      stderr: output.stderr.replaceAll(agentToken, "[redacted]"),
      stdout: output.stdout.replaceAll(agentToken, "[redacted]"),
    });
    expect(JSON.stringify(result)).not.toContain(agentToken);
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
