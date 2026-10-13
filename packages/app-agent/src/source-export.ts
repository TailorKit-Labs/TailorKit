import { randomUUID } from "node:crypto";

import { Drive, Sandbox } from "@vercel/sandbox";

const drivePrefix = "app-";

export class AppAgentWorkspaceBusyError extends Error {
  constructor() {
    super(
      "The app workspace is currently being edited. Try again when the agent finishes."
    );
    this.name = "AppAgentWorkspaceBusyError";
  }
}

const findAppDrive = async (appId: string) => {
  const name = `${drivePrefix}${appId}`;
  const { drives } = await Drive.list({
    limit: 1,
    namePrefix: name,
    sortBy: "name",
  });
  return drives.find((drive) => drive.name === name) ?? null;
};

export const getAppAgentWorkspaceStatus = async (
  appId: string
): Promise<"missing" | "busy" | "available"> => {
  const drive = await findAppDrive(appId);
  if (!drive) {
    return "missing";
  }
  return drive.currentSandboxName ? "busy" : "available";
};

/** Export the persistent app-agent workspace as a source archive. */
export const exportAppAgentWorkspace = async (
  appId: string
): Promise<Buffer | null> => {
  const drive = await findAppDrive(appId);
  if (!drive) {
    return null;
  }
  if (drive.currentSandboxName) {
    throw new AppAgentWorkspaceBusyError();
  }

  const sandbox = await Sandbox.create({
    image: "vercel/sandbox/universal",
    mounts: { "/workspace": drive.snapshot() },
    name: `app-source-export-${randomUUID()}`,
    persistent: false,
    region: drive.region,
    timeout: 120_000,
  });

  try {
    const result = await sandbox.runCommand({
      args: [
        "--exclude=node_modules",
        "--exclude=.git",
        "--exclude=.tailorkit",
        "--exclude=.env",
        "--exclude=.env.*",
        "-czf",
        "/tmp/app-source.tar.gz",
        "-C",
        "/workspace/app",
        ".",
      ],
      cmd: "tar",
      timeoutMs: 60_000,
    });

    if (result.exitCode !== 0) {
      throw new Error("Could not package the app-agent workspace.");
    }

    const archive = await sandbox.readFileToBuffer({
      path: "/tmp/app-source.tar.gz",
    });
    if (!archive) {
      throw new Error("The app-agent source archive could not be read.");
    }
    return archive;
  } finally {
    await sandbox
      .delete({ deleteOrphanSnapshots: true })
      .catch((error: ErrorOptions["cause"]) => {
        console.warn("App source export sandbox cleanup failed", error);
      });
  }
};
