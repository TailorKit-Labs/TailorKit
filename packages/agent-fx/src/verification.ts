import { z } from "zod";

import type { AppSandboxSession } from "./sandbox-session";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).default({}),
});
const viteTestScript = /^(?:vp test|vitest)(?:\s|$)/u;
export const outputDirectory = "/workspace/app/.tailorkit/agent-deployment";

interface Check {
  name: string;
  args: string[];
}

/** Run app scripts in the VM, returning only a summary or actionable diagnostics. */
export const verifyApp = async (
  sandbox: Pick<AppSandboxSession, "readFileToBuffer" | "runCommand">,
  signal?: AbortSignal
) => {
  const manifest = await sandbox.readFileToBuffer({
    path: "/workspace/app/package.json",
  });
  if (!manifest) {
    throw new Error("Missing app package.json.");
  }
  const { scripts } = packageSchema.parse(
    JSON.parse(manifest.toString("utf-8"))
  );
  const hasScript = (name: string) => (scripts[name]?.trim().length ?? 0) > 0;
  const checks: Check[] = [];
  for (const name of ["format:fix", "lint", "format"]) {
    if (hasScript(name)) {
      checks.push({ args: ["run", name], name });
    }
  }
  if (!hasScript("lint") && !hasScript("format") && hasScript("check")) {
    checks.push({ args: ["run", "check"], name: "check" });
  }
  const testScript = scripts.test;
  if (testScript !== undefined && testScript.trim() !== "") {
    // CI disables watch mode. Empty Vite/Vitest suites are valid for UI-only apps.
    const args = ["run", "test"];
    if (viteTestScript.test(testScript)) {
      args.push("--passWithNoTests");
    }
    checks.push({ args, name: "test" });
  }
  checks.push(
    { args: ["exec", "tsc", "--noEmit"], name: "typecheck" },
    {
      args: [
        "exec",
        "node",
        "--input-type=module",
        "--eval",
        `import { build } from "vite"; await build({ build: { outDir: ${JSON.stringify(outputDirectory)} } });`,
      ],
      name: "build",
    }
  );

  const completed: string[] = [];
  /* oxlint-disable eslint/no-await-in-loop -- Each gate must pass before the next command or publication; failed commands provide their diagnostics. */
  for (const check of checks) {
    const started = Date.now();
    const result = await sandbox.runCommand({
      args: check.args,
      cmd: "pnpm",
      cwd: "/workspace/app",
      env: { CI: "true", NO_COLOR: "1" },
      signal,
      timeoutMs: 5 * 60_000,
    });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (result.exitCode !== 0) {
      return {
        exitCode: result.exitCode,
        stderr: `${check.name} failed (${elapsed}s).\n${await result.stderr()}`,
        stdout: [...completed, await result.stdout()].join("\n"),
      };
    }
    completed.push(`${check.name} passed (${elapsed}s).`);
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return { exitCode: 0, stderr: "", stdout: completed.join("\n") };
};
