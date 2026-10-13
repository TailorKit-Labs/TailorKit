import { tool } from "ai";
import { z } from "zod";

import { sandboxIdleTimeoutMs } from "#sandbox";

import {
  commandResultSchema,
  sandboxContextSchema,
  toolNativeSandbox,
  resolvePath,
} from "./utils";

export const bashTool = tool({
  contextSchema: sandboxContextSchema,
  description: "Run a shell command; timeout defaults to 30s.",
  execute: async ({ command, cwd, timeoutMs }, options) => {
    "use step";
    const sandbox = await toolNativeSandbox(options);
    const { abortSignal } = options;
    abortSignal?.throwIfAborted();

    const result = await sandbox.runCommand({
      args: ["-c", command],

      cmd: "bash",

      cwd: resolvePath(cwd),

      signal: abortSignal,

      // Bound the subprocess too; aborting HTTP alone does not kill it.
      timeoutMs: Math.min(timeoutMs, sandboxIdleTimeoutMs),
    });
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    return { exitCode: result.exitCode, stderr, stdout };
  },
  inputSchema: z.object({
    command: z.string().min(1),
    cwd: z
      .string()
      .optional()
      .describe(
        "Relative to /workspace/app, or an absolute path. Defaults to /workspace/app."
      ),
    timeoutMs: z.number().int().positive().max(2_147_483_647).default(30_000),
  }),
  outputSchema: commandResultSchema,
});
