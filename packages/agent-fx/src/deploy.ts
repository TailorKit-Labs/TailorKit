import { tool } from "ai";
import { z } from "zod";

import { getSandbox } from "./sandbox";
import type { AppSandboxSession } from "./sandbox-session";

export const createDeployTool = (dependencies: {
  sandbox: (name: string) => Promise<Pick<AppSandboxSession, "runCommand">>;
}) =>
  tool({
    contextSchema: z.object({
      agentToken: z.string(),
      sandboxName: z.string(),
    }),
    description:
      "Format source and fix lint issues, then test, typecheck, build and publish with the Patchsmith CLI. Call this directly when implementation is ready. Failures include diagnostics for repair; retry after fixing them.",
    execute: async (_input, { context, abortSignal }) => {
      const redact = (value: string) =>
        value.replaceAll(context.agentToken, "[redacted]");
      try {
        const sandbox = await dependencies.sandbox(context.sandboxName);
        const output = { exitCode: 0, stderr: "", stdout: "" };
        // oxlint-disable eslint/no-await-in-loop -- Each check must pass before the next command or publication.
        for (const args of [
          ["run", "fix"],
          ["run", "test", "--passWithNoTests"],
          ["exec", "patchsmith", "deploy", "--no-interactive"],
        ]) {
          const result = await sandbox.runCommand({
            args,
            cmd: "pnpm",
            cwd: "/workspace/app",
            env: {
              CI: "true",
              NO_COLOR: "1",
              PATCHSMITH_AGENT_TOKEN: context.agentToken,
            },
            signal: abortSignal,
            timeoutMs: 5 * 60_000,
          });
          const [stdout, stderr] = await Promise.all([
            result.stdout(),
            result.stderr(),
          ]);
          output.exitCode = result.exitCode;
          output.stdout += redact(stdout);
          output.stderr += redact(stderr);
          if (result.exitCode !== 0) {
            break;
          }
        }
        // oxlint-enable eslint/no-await-in-loop
        return output;
      } catch (error) {
        return {
          exitCode: 1,
          stderr: redact(
            error instanceof Error ? error.message : String(error)
          ),
          stdout: "",
        };
      }
    },
    inputSchema: z.strictObject({}),
  });

export const deployTool = createDeployTool({
  sandbox: async (name) => {
    const sandbox = await getSandbox(name);
    return sandbox.currentSession();
  },
});
