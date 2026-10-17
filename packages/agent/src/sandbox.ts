import type { Sandbox } from "@vercel/sandbox";
import { FatalError } from "workflow";

import { threadSandboxName } from "./identity";
import type { AppAgentInput } from "./input";
import type { HostSchemaDocument } from "./schema";
import type { SavedAgentSession } from "./session-store";

// Legacy snapshots may retain this path; remove it before exposing a resumed VM.
const agentTokenPath = "/tmp/tailorkit-agent.token";
export const agentSchemaPath = "/workspace/tailorkit.schema.json";
export const sandboxIdleTimeoutMs = 15 * 60_000;

/** Retrieve and restore this app's persistent VM, then top up its lifetime. */
export const getSandbox = async (name: string) => {
  const { Sandbox } = await import("@vercel/sandbox");
  const sandbox = await Sandbox.get({ name, resume: true });
  const expiresAt = sandbox.expiresAt?.getTime();
  if (expiresAt !== undefined) {
    const extension = Date.now() + sandboxIdleTimeoutMs - expiresAt;
    if (extension >= 1000) {
      await sandbox.currentSession().extendTimeout(extension);
    }
  }
  return sandbox;
};

/** The native adapter defaults to /vercel/sandbox; app tools use /workspace/app. */
export const networkSession = async (sandbox: Sandbox) => {
  const { createVercelNetworkSandboxSessionFromNativeSandbox } =
    await import("@ai-sdk/sandbox-vercel");
  const session = createVercelNetworkSandboxSessionFromNativeSandbox(sandbox);
  Object.defineProperty(session, "defaultWorkingDirectory", {
    value: "/workspace/app",
  });
  return session;
};

export const writeAgentSchema = async (
  sandbox: Sandbox,
  schema: HostSchemaDocument
) => {
  await sandbox.currentSession().writeFiles([
    {
      content: Buffer.from(JSON.stringify(schema), "utf-8"),
      path: agentSchemaPath,
    },
  ]);
};

/** Used after failed turns or explicit cancellation; the app's Drive survives. */
export const deleteSandbox = async (name: string) => {
  const { APIError, Sandbox } = await import("@vercel/sandbox");
  try {
    const sandbox = await Sandbox.get({ name });
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch (error) {
    if (error instanceof APIError && error.response.status === 404) {
      return;
    }
    throw error;
  }
};

/** Remove credentials left by a VM snapshot created before host-side publication. */
export const removeLegacyAgentToken = async (sandbox: Sandbox) => {
  const result = await sandbox.currentSession().runCommand({
    args: ["-f", agentTokenPath],
    cmd: "rm",
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new FatalError("Could not remove legacy agent authorization.");
  }
};

const prepareAppSandbox = async (
  input: AppAgentInput,
  saved: SavedAgentSession
) => {
  const { Drive, Sandbox } = await import("@vercel/sandbox");
  const sandboxName = threadSandboxName(input.threadId);
  let sandbox: Sandbox;
  if (saved.cleanupSandboxName !== undefined) {
    await deleteSandbox(saved.cleanupSandboxName);
  }
  if (saved.resumeFrom) {
    // Never replace a missing snapshot with a blank VM and stale resume state.
    if (saved.sandboxName !== sandboxName) {
      throw new FatalError(
        "The saved app agent sandbox does not match its session."
      );
    }
    sandbox = await getSandbox(sandboxName);
  } else {
    // With the database lease already held, discard an abandoned VM. Repeating
    // this setup step after a crash is safe because no agent turn has started.
    await deleteSandbox(sandboxName);
    const drive = await Drive.getOrCreate({
      maxSize: 5 * 1024 * 1024 * 1024,
      name: `app-${input.appId}`,
    });
    if (
      drive.currentSandboxName !== undefined &&
      drive.currentSandboxName !== "" &&
      drive.currentSandboxName !== sandboxName
    ) {
      throw new FatalError(
        "This app is already being edited. Retry after the active run finishes."
      );
    }
    sandbox = await Sandbox.getOrCreate({
      image: "vercel/sandbox/universal",
      keepLastSnapshots: { count: 1 },
      mounts: { "/workspace": drive },
      name: sandboxName,
      persistent: true,
      region: drive.region,
      timeout: sandboxIdleTimeoutMs,
    });
  }
  return sandbox;
};

const prepareAppWorkspace = async (sandbox: Sandbox, input: AppAgentInput) => {
  if (input.schema !== undefined) {
    await writeAgentSchema(sandbox, input.schema);
  }
  const { prepareWorkspace } = await import("./workspace");
  await prepareWorkspace(
    sandbox.currentSession(),
    input,
    input.schema === undefined ? undefined : agentSchemaPath
  );
};

/** Stop only at the end of the user turn; retain Pi's session journal. */
export const stopSandboxStep = async (sandboxName: string) => {
  "use step";
  const sandbox = await getSandbox(sandboxName);
  await removeLegacyAgentToken(sandbox);
  await sandbox.stop();
};

/** New adapters prepare app source without Pi's snapshot migration. */
export const prepareAppSandboxStep = async (
  input: AppAgentInput,
  saved: SavedAgentSession
) => {
  "use step";
  const sandbox = await prepareAppSandbox(input, saved);
  await prepareAppWorkspace(sandbox, input);
};

export const stopAppSandboxStep = async (sandboxName: string) => {
  "use step";
  const sandbox = await getSandbox(sandboxName);
  await sandbox.stop();
};

/** Pi alone retains cleanup for snapshots created by its earlier implementation. */
export const prepareSandboxStep = async (
  input: AppAgentInput,
  saved: SavedAgentSession
) => {
  "use step";
  const sandbox = await prepareAppSandbox(input, saved);
  await removeLegacyAgentToken(sandbox);
  await prepareAppWorkspace(sandbox, input);
};
