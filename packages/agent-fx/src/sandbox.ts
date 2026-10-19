import { createVercelNetworkSandboxSessionFromNativeSandbox } from "@ai-sdk/sandbox-vercel";
import { APIError, Drive, Sandbox } from "@vercel/sandbox";

import type { AppAgentInput } from "./input";

export const sandboxName = (threadId: string) => `fx-${threadId}`;
const timeout = 30 * 60_000;

export const getSandbox = async (name: string) => {
  const sandbox = await Sandbox.get({ name, resume: true });
  const remaining = (sandbox.expiresAt?.getTime() ?? Date.now()) - Date.now();
  if (remaining < timeout - 1000) {
    await sandbox.currentSession().extendTimeout(timeout - remaining);
  }
  return sandbox;
};

export const sandboxSession = (sandbox: Sandbox) => {
  const session = createVercelNetworkSandboxSessionFromNativeSandbox(sandbox);
  // The adapter has no cwd option; relative fx paths must point at the mounted app.
  Object.defineProperty(session, "defaultWorkingDirectory", {
    value: "/workspace/app",
  });
  return session;
};

const preparePackageManager = async (sandbox: Sandbox) => {
  // Agent workspaces intentionally accept newly published packages. Configure this
  // once per turn, including old snapshots, rather than on every model step.
  const result = await sandbox.currentSession().runCommand({
    args: [
      "-c",
      "pnpm config set --global minimumReleaseAge 0 && pnpm config set --global dlxCacheMaxAge 0 && mkdir -p /workspace/app",
    ],
    cmd: "bash",
  });
  if (result.exitCode !== 0) {
    throw new Error("Could not prepare the app package manager.");
  }
  return sandbox;
};

export const prepareSandbox = async (input: AppAgentInput, resume: boolean) => {
  const name = sandboxName(input.threadId);
  if (resume) {
    return await preparePackageManager(await getSandbox(name));
  }
  const drive = await Drive.getOrCreate({
    maxSize: 5 * 1024 ** 3,
    name: `app-${input.appId}`,
  });
  if (
    drive.currentSandboxName !== undefined &&
    drive.currentSandboxName !== "" &&
    drive.currentSandboxName !== name
  ) {
    throw new Error(
      "This app is already being edited. Retry after that turn finishes."
    );
  }
  const sandbox = await Sandbox.getOrCreate({
    image: "vercel/sandbox/universal",
    keepLastSnapshots: { count: 1 },
    mounts: { "/workspace": drive },
    name,
    persistent: true,
    region: drive.region,
    timeout,
  });
  return await preparePackageManager(sandbox);
};

export const deleteSandbox = async (threadId: string) => {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName(threadId) });
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch (error) {
    if (!(error instanceof APIError && error.response.status === 404)) {
      throw error;
    }
  }
};
