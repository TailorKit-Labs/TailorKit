import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { createPatchsmithClient } from "@patchsmith/core/server";
import { loadPatchsmithConfig } from "@patchsmith/vite/config/loader";
import { z } from "zod";

import { getAgentAuth } from "./agent-auth";
import { createCliClient } from "./client";
import { normalizeHostUrl } from "./utils/url";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

interface AuthOptions {
  host?: string;
  configPath?: string;
  cwd?: string;
}

interface LoginOptions extends AuthOptions {
  timeout?: number;
}

type NamedScope = z.output<typeof namedScopeSchema>;

interface StoredHostAuth {
  deployToken: string;
  scope: NamedScope;
}

interface AuthStore {
  hosts?: Record<string, StoredHostAuth>;
}

interface CliAuthVerifyResult {
  scope: NamedScope;
}

const namedScopeSchema = z.object({
  name: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
});

const cliAuthStartSchema = z.object({
  deviceCode: z.string(),
  expiresAt: z.union([z.string(), z.date()]),
  userCode: z.string(),
});
const cliAuthPollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("expired") }),
  z.object({
    deployToken: z.string(),
    scope: namedScopeSchema,
    status: z.literal("approved"),
  }),
]);

const authStorePath = path.join(homedir(), ".patchsmith", "auth.json");

const defaultLoginTimeoutMs = 30 * 60 * 1000;

const pollIntervalMs = 2000;

const storedHostAuthSchema = z.object({
  deployToken: z.string().min(1),
  scope: namedScopeSchema,
});

const approvedCliAuthResultSchema = z.object({
  deployToken: z.string().min(1),
  scope: namedScopeSchema,
});

const verifiedCliAuthResultSchema = z.object({ scope: namedScopeSchema });

const authStoreSchema = z
  .object({
    hosts: z.record(z.string(), storedHostAuthSchema).optional(),
  })
  .loose();

const sleep = async (milliseconds: number): Promise<void> => {
  await (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<ReturnType<() => void>>();
    try {
      setTimeout(resolve, milliseconds);
    } catch (error) {
      rejectPending(error);
    }
    await pendingPromise;
  })();
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser, serializer, or runtime adapter handles arbitrary values before validating or encoding their domain representation.
const throwRpcError = (result: unknown) => {
  if (
    isObjectValue(result) &&
    "error" in result &&
    result.error !== undefined
  ) {
    // oxlint-disable-next-line typescript/only-throw-error -- Preserve the transport failure object, including its code and metadata, for the existing downstream error mapping.
    throw result.error;
  }
};

const readAuthStore = async (): Promise<AuthStore> => {
  try {
    return authStoreSchema.parse(
      JSON.parse(await readFile(authStorePath, "utf-8"))
    );
  } catch (error) {
    if (isObjectValue(error) && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
};

const writeAuthStore = async (store: AuthStore): Promise<void> => {
  await mkdir(path.dirname(authStorePath), { recursive: true });
  await writeFile(authStorePath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(authStorePath, 0o600);
};

/** Choose the JWT platform route when supplied, otherwise the configured host. */
export const resolveHostUrl = async (options: AuthOptions): Promise<string> => {
  const agent = getAgentAuth();
  if (agent) {
    return agent.platformUrl;
  }
  if (options.host !== undefined) {
    let url: URL;
    try {
      url = new URL(options.host);
    } catch {
      throw new Error(
        "Invalid Patchsmith host URL. Use an absolute http:// or https:// URL."
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        "Invalid Patchsmith host URL. Use an absolute http:// or https:// URL."
      );
    }
    return normalizeHostUrl(options.host);
  }
  const loaded = await loadPatchsmithConfig(options.configPath, options.cwd);
  if (loaded.config.host) {
    return normalizeHostUrl(loaded.config.host);
  }

  throw new Error(
    "Missing Patchsmith host URL. Set host in patchsmith.config.ts."
  );
};

export const createCliAuthApprovalUrl = (
  hostUrl: string,
  userCode: string
): string => {
  const url: URL = new URL(hostUrl);
  const pathname = url.pathname.replace(/\/+$/u, "");

  url.pathname = `${pathname}/cli-auth/approve`;
  url.search = "";
  url.searchParams.set("code", userCode);
  url.hash = "";

  return url.toString();
};

export class NotLoggedInError extends Error {
  constructor(hostUrl: string) {
    super(
      `Not logged in for ${hostUrl}. Run patchsmith login --host ${hostUrl}.`
    );
    this.name = "NotLoggedInError";
  }
}

export const saveDeployToken = async (
  hostUrl: string,
  auth: StoredHostAuth
): Promise<void> => {
  const store = await readAuthStore();
  await writeAuthStore({
    ...store,
    hosts: {
      ...store.hosts,
      [hostUrl]: auth,
    },
  });
};

export const removeDeployToken = async (hostUrl: string): Promise<boolean> => {
  const store = await readAuthStore();
  if (!store.hosts?.[hostUrl]) {
    return false;
  }

  const { [hostUrl]: _removed, ...hosts } = store.hosts;
  const nextStore = { ...store, hosts };

  if (Object.keys(hosts).length === 0) {
    await rm(authStorePath, { force: true });
    return true;
  }

  await writeAuthStore(nextStore);
  return true;
};

/** Prefer explicit JWT authorization without reading or changing stored host sessions. */
export const getDeployToken = async (
  hostUrl: string
): Promise<StoredHostAuth | undefined> => {
  const agent = getAgentAuth();
  if (agent) {
    return { deployToken: agent.token, scope: agent.scope };
  }
  const store = await readAuthStore();
  return store.hosts?.[hostUrl];
};

/** Verify the selected credential at its authority and persist only normal CLI sessions. */
export const runWhoami = async (
  options: AuthOptions
): Promise<{ hostUrl: string; scope: NamedScope }> => {
  const hostUrl = await resolveHostUrl(options);
  const auth = await getDeployToken(hostUrl);

  if (
    !(
      auth?.deployToken !== undefined &&
      auth?.deployToken !== null &&
      auth?.deployToken !== ""
    )
  ) {
    throw new NotLoggedInError(hostUrl);
  }

  const client = createCliClient({ token: auth.deployToken, url: hostUrl });
  let result: CliAuthVerifyResult;
  try {
    const verifyResult = await client.cliAuth.verifyToken({});
    throwRpcError(verifyResult);

    result = verifiedCliAuthResultSchema.parse(
      "data" in verifyResult ? verifyResult.data : verifyResult
    );
  } catch (error) {
    if (
      error !== null &&
      isObjectValue(error) &&
      "code" in error &&
      error.code === "UNAUTHORIZED"
    ) {
      if (getAgentAuth()) {
        throw new Error(
          "Agent authorization expired or revoked. Start a new agent turn.",
          { cause: error }
        );
      }
      throw new NotLoggedInError(hostUrl);
    }
    throw error;
  }

  if (!getAgentAuth()) {
    await saveDeployToken(hostUrl, {
      deployToken: auth.deployToken,
      scope: result.scope,
    });
  }

  return {
    hostUrl,
    scope: result.scope,
  };
};

/** Verify a supplied JWT, or use the existing host approval flow for a CLI session. */
export const runLogin = async (
  options: LoginOptions,
  onUserCode: (details: {
    expiresAt: Date;
    hostUrl: string;
    userCode: string;
  }) => void
): Promise<{ hostUrl: string; scope: NamedScope }> => {
  if (getAgentAuth()) {
    return await runWhoami(options);
  }
  const hostUrl = await resolveHostUrl(options);
  const client = createPatchsmithClient({ url: hostUrl });
  const startResult = await client.cliAuth.start({});
  throwRpcError(startResult);

  const started = cliAuthStartSchema.parse(
    "data" in startResult ? startResult.data : startResult
  );
  const expiresAt = new Date(started.expiresAt);
  const timeoutAt = Date.now() + (options.timeout ?? defaultLoginTimeoutMs);

  onUserCode({ expiresAt, hostUrl, userCode: started.userCode });

  while (Date.now() < timeoutAt && Date.now() < expiresAt.getTime()) {
    // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
    await sleep(pollIntervalMs);
    // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
    const pollResult = await client.cliAuth.poll({
      deviceCode: started.deviceCode,
    });
    throwRpcError(pollResult);

    const result = cliAuthPollSchema.parse(
      "data" in pollResult ? pollResult.data : pollResult
    );

    switch (result.status) {
      case "pending": {
        continue;
      }
      case "denied": {
        throw new Error("CLI login was denied.");
      }
      case "expired": {
        throw new Error("CLI login expired.");
      }
      case "approved": {
        const approved = approvedCliAuthResultSchema.parse(result);
        // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
        await saveDeployToken(hostUrl, {
          deployToken: approved.deployToken,
          scope: approved.scope,
        });

        return {
          hostUrl,
          scope: approved.scope,
        };
      }
      default: {
        throw new Error("Unexpected CLI login status.");
      }
    }
  }

  throw new Error("Timed out waiting for CLI login approval.");
};

/** Remove a stored host session; environment/file JWTs remain managed by their caller. */
export const runLogout = async (
  options: AuthOptions
): Promise<{ hostUrl: string; removed: boolean }> => {
  const hostUrl = await resolveHostUrl(options);
  return {
    hostUrl,
    removed: getAgentAuth() ? false : await removeDeployToken(hostUrl),
  };
};
