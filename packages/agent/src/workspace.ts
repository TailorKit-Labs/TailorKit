import type { Sandbox } from "@vercel/sandbox";

import type { AppAgentInput } from "./input";

const cliDirectory = "/tmp/tailorkit-cli";
const scaffoldDirectory = "/workspace/.tailorkit-scaffold";
const stagedAppDirectory = `${scaffoldDirectory}/new-app`;
const setupMarker = ".tailorkit-setup-pending";

export const packageReleasePolicy = `minimumReleaseAge: 4320
minimumReleaseAgeStrict: true
minimumReleaseAgeExclude:
  - tailorkit
  - "@tailorkit/*"
# The platform-specific esbuild binary is installed as an optional dependency.
allowBuilds:
  esbuild: false
`;

/** Prepare tools and new app source before spending any model calls on setup. */
export const prepareWorkspace = async (
  session: Pick<
    ReturnType<Sandbox["currentSession"]>,
    "readFileToBuffer" | "runCommand" | "writeFiles"
  >,
  input: AppAgentInput,
  schemaPath?: string
) => {
  const appExists = Boolean(
    await session.readFileToBuffer({ path: "/workspace/app/package.json" })
  );
  const setupPending =
    appExists &&
    Boolean(
      await session.readFileToBuffer({
        path: `/workspace/app/${setupMarker}`,
      })
    );
  const appReady = appExists && !setupPending;
  if (
    appReady &&
    (await session.readFileToBuffer({
      path: `${cliDirectory}/node_modules/.bin/tailorkit`,
    }))
  ) {
    return;
  }

  const run = async (
    cmd: string,
    args: string[],
    cwd: string,
    description: string
  ) => {
    const result = await session.runCommand({
      args,
      cmd,
      cwd,
      env: { CI: "true" },
      timeoutMs: 5 * 60_000,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      throw new Error(
        `${description} failed: ${stderr.replaceAll(input.agentToken, "[redacted]")}`
      );
    }
  };

  await session.writeFiles([
    {
      content: Buffer.from(JSON.stringify({ private: true })),
      path: `${cliDirectory}/package.json`,
    },
    {
      content: Buffer.from(packageReleasePolicy),
      path: `${cliDirectory}/pnpm-workspace.yaml`,
    },
  ]);
  // The umbrella package includes the CLI at the exact same beta version.
  await run(
    "pnpm",
    ["add", "--save-exact", "tailorkit@beta"],
    cliDirectory,
    "TailorKit CLI installation"
  );

  if (appReady) {
    return;
  }

  const schemaArguments =
    schemaPath === undefined ? [] : ["--schema", schemaPath];

  if (!appExists) {
    // Rename a complete scaffold into place; the marker makes interrupted installs retryable.
    await run(
      "rm",
      ["-rf", scaffoldDirectory],
      "/workspace",
      "Scaffold cleanup"
    );
    await run(
      "pnpm",
      [
        "exec",
        "tailorkit",
        "init",
        scaffoldDirectory,
        "--name",
        "new-app",
        "--host",
        input.hostUrl,
        ...schemaArguments,
        "--package-manager",
        "pnpm",
        "--tooling",
        "vite-plus",
        "--no-install",
      ],
      cliDirectory,
      "App scaffolding"
    );
    await session.writeFiles([
      {
        content: Buffer.from(packageReleasePolicy),
        path: `${stagedAppDirectory}/pnpm-workspace.yaml`,
      },
      {
        content: Buffer.from("Setup must complete before the agent starts.\n"),
        path: `${stagedAppDirectory}/${setupMarker}`,
      },
    ]);
    await run(
      "mv",
      ["-T", stagedAppDirectory, "/workspace/app"],
      "/workspace",
      "App workspace creation"
    );
  }

  // Install at the final path because package-manager links may contain absolute paths.
  await run(
    "pnpm",
    ["install"],
    "/workspace/app",
    "App dependency installation"
  );
  await run(
    "pnpm",
    ["run", "generate", ...schemaArguments],
    "/workspace/app",
    "Host binding generation"
  );
  await run(
    "rm",
    ["-f", `/workspace/app/${setupMarker}`],
    "/workspace/app",
    "App setup completion"
  );
};
