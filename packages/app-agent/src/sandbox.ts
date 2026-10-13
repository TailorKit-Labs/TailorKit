import { APIError, Drive, Sandbox } from "@vercel/sandbox";
import { FatalError } from "workflow";

export const agentTokenPath = "/tmp/tailorkit-agent.token";

export const sandboxIdleTimeoutMs = 15 * 60_000;

/** Retrieve the existing VM and top up its remaining lifetime to 15 minutes. */
export const getSandbox = async (name: string) => {
  try {
    const sandbox = await Sandbox.get({ name });
    const expiresAt = sandbox.expiresAt?.getTime();
    if (sandbox.status !== "running" || !expiresAt || expiresAt <= Date.now()) {
      throw new FatalError("App agent sandbox is no longer running.");
    }
    const extension = Date.now() + sandboxIdleTimeoutMs - expiresAt;
    // The Sandbox API rejects extensions shorter than one second. Near the
    // 15-minute boundary, clock and request latency can produce a smaller top-up.
    if (extension >= 1000) {
      // Session methods cannot auto-resume a stopped VM and remount its Drive.
      await sandbox.currentSession().extendTimeout(extension);
    }
    return sandbox;
  } catch (error) {
    if (error instanceof APIError) {
      throw new FatalError(`Cannot access app sandbox: ${error.message}`);
    }
    throw error;
  }
};

/** Provision ephemeral CLI authorization without putting the bearer in command arguments. */
export const writeAgentToken = async (sandboxName: string, token: string) => {
  "use step";
  const awaitedResult1 = await getSandbox(sandboxName);
  const session = awaitedResult1.currentSession();
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

export const agentSchemaPath = "/workspace/tailorkit.schema.json";

export const writeAgentSchema = async (
  sandboxName: string,
  schema: Record<string, unknown>
) => {
  "use step";
  const sandbox = await getSandbox(sandboxName);
  await sandbox.currentSession().writeFiles([
    {
      content: Buffer.from(JSON.stringify(schema), "utf-8"),
      path: agentSchemaPath,
    },
  ]);
};

export const prepareSandbox = async (
  driveName: string,
  sandboxName: string
) => {
  "use step";
  try {
    const drive = await Drive.getOrCreate({
      // 5 GiB
      maxSize: 5 * 1024 * 1024 * 1024,
      name: driveName,
    });
    if (drive.currentSandboxName && drive.currentSandboxName !== sandboxName) {
      throw new FatalError(
        "This app is already being edited. Retry after the active run finishes."
      );
    }
    // The mount is the atomic lock, including when two detached-Drive checks race.
    await Sandbox.getOrCreate({
      env: { TAILORKIT_AGENT_TOKEN_FILE: agentTokenPath },
      image: "vercel/sandbox/universal",
      mounts: { "/workspace": drive },
      name: sandboxName,
      persistent: false,
      region: drive.region,
      timeout: sandboxIdleTimeoutMs,
    });
  } catch (error) {
    // Mount conflicts end the workflow instead of turning into waiting retries.
    if (error instanceof APIError) {
      throw new FatalError(`Cannot open app workspace: ${error.message}`);
    }
    throw error;
  }
};

export const renewSandbox = async (name: string) => {
  "use step";
  await getSandbox(name);
};

/** Best-effort cleanup after a workflow finishes or its MCP request ends. Its Drive survives. */
export const deleteSandbox = async (name: string) => {
  "use step";
  try {
    const sandbox = await Sandbox.get({ name });
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch (error) {
    if (error instanceof APIError && error.response.status === 404) {
      return;
    }
    console.warn(
      "App agent sandbox cleanup failed; idle timeout will release the Drive",
      error
    );
  }
};
