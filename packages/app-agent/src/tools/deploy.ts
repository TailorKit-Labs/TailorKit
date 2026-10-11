import { tool } from "ai";
import { z } from "zod";
import { sandboxIdleTimeoutMs } from "../sandbox";
import { commandResultSchema, sandboxContextSchema, toolNativeSandbox } from "./utils";

export const deployTool = tool({
  description:
    "Build, type-check, and publish the finished app to its authorized TailorKit app. No login or host access is needed. Call only after completing and verifying the requested changes.",
  contextSchema: sandboxContextSchema.extend({
    appId: z.string().min(1),
    agentToken: z.string().min(1),
  }),
  inputSchema: z.strictObject({}),
  outputSchema: commandResultSchema,
  execute: async (_input, options) => {
    "use step";
    const { appId, agentToken } = options.context;
    try {
      const sandbox = await toolNativeSandbox(options);
      const result = await sandbox.runCommand({
        cmd: "pnpm",
        args: [
          "--dir",
          "/tmp/tailorkit-cli",
          "exec",
          "tailorkit",
          "deploy",
          "--cwd",
          "/workspace/app",
          "--app-id",
          appId,
          "--no-interactive",
        ],
        cwd: "/workspace/app",
        env: { TAILORKIT_AGENT_TOKEN: agentToken },
        signal: options.abortSignal,
        timeoutMs: sandboxIdleTimeoutMs,
      });
      const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
      // Never put credentials in the model stream, even if a subprocess echoes them.
      return {
        exitCode: result.exitCode,
        stdout: stdout.replaceAll(agentToken, "[redacted]"),
        stderr: stderr.replaceAll(agentToken, "[redacted]"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { exitCode: 1, stdout: "", stderr: message.replaceAll(agentToken, "[redacted]") };
    }
  },
});
