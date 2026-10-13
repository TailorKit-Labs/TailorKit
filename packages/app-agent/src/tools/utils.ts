import nodePath from "node:path";

import type {
  Experimental_SandboxSession as SandboxSession,
  ToolExecutionOptions,
} from "ai";
import { FatalError } from "workflow";
import { z } from "zod";

import { getSandbox, sandboxIdleTimeoutMs } from "../sandbox";

const { posix } = nodePath;

export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export const appDirectory = "/workspace/app";
export const resolvePath = (path = ".") =>
  posix.isAbsolute(path) ? path : posix.resolve(appDirectory, path);

export const commandResultSchema = z.object({
  exitCode: z.number(),
  stderr: z.string(),
  stdout: z.string(),
});
export const fileChangeResultSchema = z.object({
  path: z.string(),
  success: z.literal(true),
});
export const sandboxContextSchema = z.object({
  sandboxName: z.string().min(1),
});

export const toolNativeSandbox = async (
  options: ToolExecutionOptions<z.infer<typeof sandboxContextSchema>>
) => {
  const name = options.context?.sandboxName;
  if (!name) {
    throw new FatalError("App agent sandbox context is missing.");
  }
  options.abortSignal?.throwIfAborted();
  const awaitedResult1 = await getSandbox(name);
  return awaitedResult1.currentSession();
};

/** The tools' file/command surface, pinned to one VM with no automatic resume. */
export const toolSandbox = async (
  options: ToolExecutionOptions<z.infer<typeof sandboxContextSchema>>
) => {
  const session = await toolNativeSandbox(options);
  return {
    async readTextFile({
      path,
      startLine,
      endLine,
      abortSignal,
    }: Parameters<SandboxSession["readTextFile"]>[0]) {
      const buffer = await session.readFileToBuffer(
        { path },
        { signal: abortSignal }
      );
      if (buffer === null) {
        return null;
      }
      const text = buffer.toString("utf-8");
      if (startLine === undefined && endLine === undefined) {
        return text;
      }
      return text
        .split("\n")
        .slice((startLine ?? 1) - 1, endLine)
        .join("\n");
    },
    async run({
      command,
      workingDirectory,
      abortSignal,
    }: Parameters<SandboxSession["run"]>[0]) {
      const result = await session.runCommand({
        args: ["-c", command],
        cmd: "bash",
        cwd: workingDirectory,
        signal: abortSignal,
        timeoutMs: sandboxIdleTimeoutMs,
      });
      const [stdout, stderr] = await Promise.all([
        result.stdout(),
        result.stderr(),
      ]);
      return { exitCode: result.exitCode, stderr, stdout };
    },
    async writeTextFile({
      path,
      content,
      abortSignal,
    }: Parameters<SandboxSession["writeTextFile"]>[0]) {
      await session.runCommand({
        args: ["-p", posix.dirname(path)],
        cmd: "mkdir",
        signal: abortSignal,
        timeoutMs: 30_000,
      });
      await session.writeFiles(
        [{ content: Buffer.from(content, "utf-8"), path }],
        {
          signal: abortSignal,
        }
      );
    },
  };
};
