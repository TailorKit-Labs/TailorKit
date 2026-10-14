import { tool } from "ai";
import { z } from "zod";

import {
  sandboxContextSchema,
  toolSandbox,
  fileChangeResultSchema,
  resolvePath,
} from "./utils";

export const writeTool = tool({
  contextSchema: sandboxContextSchema,
  description: "Create or overwrite a text file, creating parent directories.",
  execute: async ({ path, content }, options) => {
    "use step";
    const sandbox = await toolSandbox(options);
    const { abortSignal } = options;
    const resolvedPath = resolvePath(path);
    await sandbox.writeTextFile({ abortSignal, content, path: resolvedPath });
    return { path: resolvedPath, success: true };
  },
  inputSchema: z.object({
    content: z.string(),
    path: z
      .string()
      .min(1)
      .describe("Relative to /workspace/app, or an absolute path."),
  }),
  outputSchema: fileChangeResultSchema,
});
