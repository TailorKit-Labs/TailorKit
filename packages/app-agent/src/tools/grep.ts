import { tool } from "ai";
import { z } from "zod";

import {
  appDirectory,
  commandResultSchema,
  sandboxContextSchema,
  toolSandbox,
  quote,
  resolvePath,
} from "./utils";

export const grepTool = tool({
  contextSchema: sandboxContextSchema,
  description:
    "Search with ripgrep. Returns matching lines with filenames and line numbers; exit 1 means no matches.",
  execute: async ({ pattern, path, glob, ignoreCase, literal }, options) => {
    "use step";
    const sandbox = await toolSandbox(options);
    const { abortSignal } = options;
    const args = [
      "rg",
      "--no-config",
      "--line-number",
      "--with-filename",
      "--color",
      "never",
      "--hidden",
    ];
    if (ignoreCase) {
      args.push("--ignore-case");
    }
    if (literal) {
      args.push("--fixed-strings");
    }
    if (glob !== undefined && glob !== null && glob !== "") {
      args.push("--glob", glob);
    }
    args.push("--", pattern, resolvePath(path));
    return await sandbox.run({
      abortSignal,
      command: args.map(quote).join(" "),
      workingDirectory: appDirectory,
    });
  },
  inputSchema: z.object({
    glob: z
      .string()
      .min(1)
      .optional()
      .describe("An optional ripgrep file glob, such as *.ts."),
    ignoreCase: z.boolean().default(false),
    literal: z.boolean().default(false),
    path: z
      .string()
      .default(".")
      .describe("File or directory relative to /workspace/app, or absolute."),
    pattern: z.string().min(1),
  }),
  outputSchema: commandResultSchema,
});
