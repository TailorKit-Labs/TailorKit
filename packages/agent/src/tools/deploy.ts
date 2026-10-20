import { tool } from "ai";
import { z } from "zod";

import { sandboxIdleTimeoutMs } from "#sandbox";

import { deploymentDirectory, publishDeployment } from "./publish";
import {
  commandResultSchema,
  sandboxContextSchema,
  toolNativeSandbox,
} from "./utils";

type NativeSession = Awaited<ReturnType<typeof toolNativeSandbox>>;
export interface DeploymentSandbox {
  readFileToBuffer: NativeSession["readFileToBuffer"];
  runCommand: (
    options: Parameters<NativeSession["runCommand"]>[0]
  ) => Promise<
    Pick<
      Awaited<ReturnType<NativeSession["runCommand"]>>,
      "exitCode" | "stdout" | "stderr"
    >
  >;
}

export const createDeployTool = (dependencies: {
  publish: typeof publishDeployment;
  sandbox: (
    options: Parameters<typeof toolNativeSandbox>[0]
  ) => Promise<DeploymentSandbox>;
}) =>
  tool({
    contextSchema: sandboxContextSchema.extend({
      agentToken: z.string().min(1),
      appId: z.string().min(1),
    }),
    description:
      "Build, type-check, and publish the finished app to its authorized Patchsmith app. Run lint and relevant tests first; this tool owns the build and type check, so do not run a separate build before calling it. Failures include compiler diagnostics for repair. No login or host access is needed.",
    execute: async (_input, options) => {
      const { agentToken } = options.context;
      const redact = (value: string) =>
        value.replaceAll(agentToken, "[redacted]");
      try {
        const sandbox = await dependencies.sandbox(options);
        // oxlint-disable eslint/no-await-in-loop -- Typechecking must succeed before building; failures return diagnostics immediately.
        for (const args of [
          ["exec", "tsc", "--noEmit"],
          [
            "exec",
            "node",
            "--input-type=module",
            "--eval",
            `import { build } from "vite"; await build({ build: { outDir: ${JSON.stringify(deploymentDirectory)} } });`,
          ],
        ]) {
          const result = await sandbox.runCommand({
            args,
            cmd: "pnpm",
            cwd: "/workspace/app",
            env: { CI: "true", NO_COLOR: "1" },
            signal: options.abortSignal,
            timeoutMs: sandboxIdleTimeoutMs,
          });
          if (result.exitCode !== 0) {
            return {
              exitCode: result.exitCode,
              stderr: redact(await result.stderr()),
              stdout: redact(await result.stdout()),
            };
          }
        }
        // oxlint-enable eslint/no-await-in-loop
        const stdout = await dependencies.publish(
          sandbox,
          options.context,
          options.abortSignal
        );
        return { exitCode: 0, stderr: "", stdout: redact(stdout) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { exitCode: 1, stderr: redact(message), stdout: "" };
      }
    },
    inputSchema: z.strictObject({}),
    outputSchema: commandResultSchema,
  });

export const deployTool = createDeployTool({
  publish: publishDeployment,
  sandbox: toolNativeSandbox,
});
