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
      "Build, typecheck and publish the app with the TailorKit CLI. Run lint and relevant tests first. Failures include diagnostics for repair; retry after fixing them.",
    execute: async (_input, { context, abortSignal }) => {
      const redact = (value: string) =>
        value.replaceAll(context.agentToken, "[redacted]");
      try {
        const sandbox = await dependencies.sandbox(context.sandboxName);
        const result = await sandbox.runCommand({
          args: ["exec", "tailorkit", "deploy", "--no-interactive"],
          cmd: "pnpm",
          cwd: "/workspace/app",
          env: {
            CI: "true",
            NO_COLOR: "1",
            TAILORKIT_AGENT_TOKEN: context.agentToken,
          },
          signal: abortSignal,
          timeoutMs: 5 * 60_000,
        });
        const [stdout, stderr] = await Promise.all([
          result.stdout(),
          result.stderr(),
        ]);
        return {
          exitCode: result.exitCode,
          stderr: redact(stderr),
          stdout: redact(stdout),
        };
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
