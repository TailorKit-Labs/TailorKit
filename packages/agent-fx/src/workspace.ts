import type { AppAgentInput } from "./input";
import type { AppSandboxSession } from "./sandbox-session";

const stagingDirectory = "/workspace/.patchsmith-scaffold";
const setupMarker = "/workspace/app/.patchsmith-setup-pending";
export const hostSchemaPath = "/workspace/patchsmith.schema.json";

/** Set up new apps before inference, preserving existing and partially installed apps. */
export const prepareWorkspace = async (
  session: AppSandboxSession,
  input: AppAgentInput
) => {
  const appExists = Boolean(
    await session.readFileToBuffer({ path: "/workspace/app/package.json" })
  );
  if (appExists && !(await session.readFileToBuffer({ path: setupMarker }))) {
    return;
  }

  const run = async (
    cmd: string,
    args: string[],
    description: string,
    cwd = "/workspace"
  ) => {
    const result = await session.runCommand({
      args,
      cmd,
      cwd,
      env: { CI: "true", NO_COLOR: "1" },
      timeoutMs: 5 * 60_000,
    });
    if (result.exitCode !== 0) {
      const diagnostics = `${await result.stdout()}\n${await result.stderr()}`;
      throw new Error(
        `${description} failed: ${diagnostics.replaceAll(input.agentToken, "[redacted]")}`
      );
    }
  };

  if (!appExists) {
    await run("rm", ["-rf", stagingDirectory], "Staging cleanup");
    await run(
      "pnpm",
      [
        "dlx",
        "patchsmith@beta",
        "init",
        stagingDirectory,
        "--name",
        "app",
        "--host",
        input.hostUrl,
        ...(input.schema === undefined ? [] : ["--schema", hostSchemaPath]),
        "--package-manager",
        "pnpm",
        "--tooling",
        "vite-plus",
        "--bare",
        "--no-install",
      ],
      "Bare app scaffolding"
    );
    await session.writeFiles([
      {
        content: Buffer.from("Complete setup before starting the agent.\n"),
        path: `${stagingDirectory}/app/.patchsmith-setup-pending`,
      },
    ]);
    // mv refuses to replace a nonempty directory, protecting source without a manifest.
    await run(
      "mv",
      ["-T", `${stagingDirectory}/app`, "/workspace/app"],
      "App workspace creation"
    );
  }

  await run(
    "pnpm",
    ["install"],
    "App dependency installation",
    "/workspace/app"
  );
  // init already generated host bindings; installation does not change that contract.
  await run("rm", ["-f", setupMarker], "App setup completion");
};
