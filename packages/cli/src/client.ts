import { agentChunkSchema } from "@tailorkit/client-platform/agent";
import {
  appsCreate,
  appsList,
  appsGet,
  appsDelete,
  appsUpdate,
  appsDeploy,
  deploymentsCreate,
  deploymentsPublish,
  deploymentsList,
  deploymentsGet,
  cliAuthVerifyToken,
  previewStart,
  previewStop,
  appAgentChat,
} from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import { createTailorKitClient } from "@tailorkit/core/server";
import type { TailorKitRouterClient } from "@tailorkit/core/server";

import { getAgentAuth, validatePlatformUrl } from "./agent-auth";

type Input<
  Group extends keyof TailorKitRouterClient,
  Method extends keyof TailorKitRouterClient[Group],
> = TailorKitRouterClient[Group][Method] extends (
  ...args: infer Args
) => unknown
  ? Args[0]
  : never;

/** Adapt platform HTTP errors to the existing CLI RPC error contract. */
async function request<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      throw Object.assign(new Error(error.message, { cause: error }), {
        code: "code" in error ? error.code : undefined,
      });
    }
    throw new Error(String(error), { cause: error });
  }
}

export type CliClient = Pick<
  TailorKitRouterClient,
  "apps" | "deployments" | "preview" | "appAgent"
> & {
  cliAuth: Pick<TailorKitRouterClient["cliAuth"], "verifyToken">;
};

/** All authenticated CLI commands share one credential selection and routing boundary. */
export function createCliClient(options: {
  url: string;
  token: string;
  fetch?: typeof fetch;
}): CliClient {
  const agent = getAgentAuth();
  if (!agent) {
    return createTailorKitClient({
      url: options.url,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      headers: { authorization: `Bearer ${options.token}` },
    });
  }
  const client = createClient({
    baseUrl: validatePlatformUrl(agent.platformUrl),
    fetch: options.fetch,
    headers: { authorization: `Bearer ${agent.token}` },
    redirect: "error",
    responseStyle: "data",
    throwOnError: true,
  });
  const { scope } = agent;
  const scopes = (names?: string[]) => {
    if (names && (names.length !== 1 || names[0] !== scope.name)) {
      throw new Error("Requested scope is not authorized by the agent token.");
    }
    return [scope];
  };
  // These map the host RPC shapes to existing OpenAPI routes. Both return compact bodies.
  return {
    appAgent: {
      chat: async function* (
        input: Input<"appAgent", "chat">,
        options?: { signal?: AbortSignal }
      ) {
        let streamError: unknown;
        let done = false;
        const { stream } = await appAgentChat({
          client,
          body: { ...input, deployToken: agent.token },
          signal: options?.signal,
          sseMaxRetryAttempts: 1,
          onSseError: (error) => {
            streamError = error;
          },
        });
        for await (const chunk of stream) {
          const event = await agentChunkSchema.parseAsync(chunk);
          if (event.type === "finish" || event.type === "error") done = true;
          yield event;
        }
        options?.signal?.throwIfAborted();
        if (!done && !streamError)
          throw new Error("The agent stream ended unexpectedly. Try again.");
        if (streamError)
          throw new Error("The app agent stream failed. Try again.", {
            cause: streamError,
          });
      },
    },
    apps: {
      create: (input: Input<"apps", "create">) =>
        request(appsCreate({ client, body: { ...input, scope } })),
      delete: (input: Input<"apps", "delete">) =>
        request(
          appsDelete({ client, path: { appId: input.appId }, body: { scope } })
        ),
      deploy: (input: Input<"apps", "deploy">) =>
        request(
          appsDeploy({
            client,
            path: { appId: input.appId },
            body: { deploymentId: input.deploymentId, scope },
          })
        ),
      get: (input: Input<"apps", "get">) =>
        request(
          appsGet({
            client,
            path: { appId: input.appId },
            body: { scopes: scopes(input.scopes) },
          })
        ),
      list: (input?: Input<"apps", "list">) =>
        request(
          appsList({
            client,
            body: {
              page: input?.page,
              pageSize: input?.pageSize,
              scopes: scopes(input?.scopes),
            },
          })
        ),
      update: (input: Input<"apps", "update">) =>
        request(
          appsUpdate({
            client,
            path: { appId: input.appId },
            body: { name: input.name, description: input.description, scope },
          })
        ),
    },
    cliAuth: {
      verifyToken: () =>
        request(
          cliAuthVerifyToken({ client, body: { deployToken: agent.token } })
        ),
    },
    deployments: {
      create: (input: Input<"deployments", "create">) =>
        request(deploymentsCreate({ client, body: { ...input, scope } })),
      get: (input: Input<"deployments", "get">) =>
        request(
          deploymentsGet({
            client,
            path: { deploymentId: input.deploymentId },
            body: { scopes: scopes(input.scopes) },
          })
        ),
      list: (input: Input<"deployments", "list">) =>
        request(
          deploymentsList({
            client,
            body: {
              appId: input.appId,
              page: input.page,
              pageSize: input.pageSize,
              scopes: scopes(input.scopes),
            },
          })
        ),
      publish: (input: Input<"deployments", "publish">) =>
        request(
          deploymentsPublish({
            client,
            path: { deploymentId: input.deploymentId },
            body: { rollout: input.rollout, scope },
          })
        ),
    },
    preview: {
      start: (input: Input<"preview", "start">) =>
        request(
          previewStart({ client, body: { ...input, deployToken: agent.token } })
        ),
      stop: (input: Input<"preview", "stop">) =>
        request(
          previewStop({
            client,
            path: { sessionId: input.sessionId },
            body: { deployToken: agent.token },
          })
        ),
    },
  } as unknown as CliClient;
}
