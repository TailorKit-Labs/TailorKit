import type { Sandbox } from "@vercel/sandbox";
import { FatalError } from "workflow";

import { threadSandboxName } from "./identity";
import type { AppAgentInput } from "./input";
import type { HostSchemaDocument } from "./schema";
import type { SavedAgentSession } from "./session-store";

export const agentTokenPath = "/tmp/tailorkit-agent.token";
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

export const writeAgentToken = async (sandboxName: string, token: string) => {
  const sandbox = await getSandbox(sandboxName);
  const session = sandbox.currentSession();
  await session.writeFiles([
    { content: Buffer.from(token, "utf-8"), path: agentTokenPath },
  ]);
  const result = await session.runCommand({
    args: ["600", agentTokenPath],
    cmd: "chmod",
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new FatalError("Could not secure agent authorization file.");
  }
};

export const writeAgentSchema = async (
  sandboxName: string,
  schema: HostSchemaDocument
) => {
  const sandbox = await getSandbox(sandboxName);
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

export const prepareSandboxStep = async (
  input: AppAgentInput,
  saved: SavedAgentSession
) => {
  "use step";
  const { Drive, Sandbox } = await import("@vercel/sandbox");
  const sandboxName = threadSandboxName(input.threadId);
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
    await getSandbox(sandboxName);
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
    await Sandbox.getOrCreate({
      env: { TAILORKIT_AGENT_TOKEN_FILE: agentTokenPath },
      image: "vercel/sandbox/universal",
      keepLastSnapshots: { count: 1 },
      mounts: { "/workspace": drive },
      name: sandboxName,
      persistent: true,
      region: drive.region,
      timeout: sandboxIdleTimeoutMs,
    });
  }
  await writeAgentToken(sandboxName, input.agentToken);
  if (input.schema !== undefined) {
    await writeAgentSchema(sandboxName, input.schema);
  }
};

/** Stop only at the end of the user turn; persistence keeps Pi's persisted session journal. */
export const stopSandboxStep = async (sandboxName: string) => {
  "use step";
  const sandbox = await getSandbox(sandboxName);
  // Do not retain expired CLI credentials in the between-turn snapshot.
  const result = await sandbox
    .currentSession()
    .runCommand({ args: ["-f", agentTokenPath], cmd: "rm", timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    throw new FatalError("Could not remove ephemeral agent authorization.");
  }
  await sandbox.stop();
};
