import type { ToolExecutionOptions } from "ai";
import { FatalError } from "workflow";
import { z } from "zod";

import { getSandbox } from "#sandbox";

export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const commandResultSchema = z.object({
  exitCode: z.number(),
  stderr: z.string(),
  stdout: z.string(),
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
  const sandbox = await getSandbox(name);

  return sandbox.currentSession();
};
