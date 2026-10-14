import { tool } from "ai";
import { z } from "zod";

import { sandboxIdleTimeoutMs } from "#sandbox";

import {
  commandResultSchema,
  sandboxContextSchema,
  toolNativeSandbox,
} from "./utils";

export const deployTool = tool({
  contextSchema: sandboxContextSchema.extend({
    agentToken: z.string().min(1),
    appId: z.string().min(1),
  }),
  description:
    "Build, type-check, and publish the finished app to its authorized TailorKit app. No login or host access is needed. Call only after completing and verifying the requested changes.",
  execute: async (_input, options) => {
    const { appId, agentToken } = options.context;
    try {
      const sandbox = await toolNativeSandbox(options);
      const result = await sandbox.runCommand({
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
        cmd: "pnpm",
        cwd: "/workspace/app",
        env: { TAILORKIT_AGENT_TOKEN: agentToken },
        signal: options.abortSignal,
        timeoutMs: sandboxIdleTimeoutMs,
      });
      const [stdout, stderr] = await Promise.all([
        result.stdout(),
        result.stderr(),
      ]);
      // Never put credentials in the model stream, even if a subprocess echoes them.
      return {
        exitCode: result.exitCode,
        stderr: stderr.replaceAll(agentToken, "[redacted]"),
        stdout: stdout.replaceAll(agentToken, "[redacted]"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        exitCode: 1,
        stderr: message.replaceAll(agentToken, "[redacted]"),
        stdout: "",
      };
    }
  },
  inputSchema: z.strictObject({}),
  outputSchema: commandResultSchema,
});
