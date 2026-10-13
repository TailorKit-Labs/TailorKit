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
const request = async <T>(operation: Promise<T>): Promise<T> => {
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
};

export type CliClient = Pick<
  TailorKitRouterClient,
  "apps" | "deployments" | "preview" | "appAgent"
> & {
  cliAuth: Pick<TailorKitRouterClient["cliAuth"], "verifyToken">;
};

/** All authenticated CLI commands share one credential selection and routing boundary. */
export const createCliClient = (options: {
  url: string;
  token: string;
  fetch?: typeof fetch;
}): CliClient => {
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
      async *chat(
        input: Input<"appAgent", "chat">,
        optionsValue: { signal?: AbortSignal }
      ) {
        let streamError: unknown;
        let done = false;
        const { stream } = await appAgentChat({
          body: { ...input, deployToken: agent.token },
          client,
          onSseError: (error) => {
            streamError = error;
          },
          signal: optionsValue?.signal,
          sseMaxRetryAttempts: 1,
        });
        for await (const chunk of stream) {
          const event = await agentChunkSchema.parseAsync(chunk);
          if (event.type === "finish" || event.type === "error") {
            done = true;
          }
          yield event;
        }
        optionsValue?.signal?.throwIfAborted();
        if (!done && !streamError) {
          throw new Error("The agent stream ended unexpectedly. Try again.");
        }
        if (streamError) {
          throw new Error("The app agent stream failed. Try again.", {
            cause: streamError,
          });
        }
      },
    },
    apps: {
      create: (input: Input<"apps", "create">) =>
        request(appsCreate({ body: { ...input, scope }, client })),
      delete: (input: Input<"apps", "delete">) =>
        request(
          appsDelete({ body: { scope }, client, path: { appId: input.appId } })
        ),
      deploy: (input: Input<"apps", "deploy">) =>
        request(
          appsDeploy({
            body: { deploymentId: input.deploymentId, scope },
            client,
            path: { appId: input.appId },
          })
        ),
      get: (input: Input<"apps", "get">) =>
        request(
          appsGet({
            body: { scopes: scopes(input.scopes) },
            client,
            path: { appId: input.appId },
          })
        ),
      list: (input?: Input<"apps", "list">) =>
        request(
          appsList({
            body: {
              page: input?.page,
              pageSize: input?.pageSize,
              scopes: scopes(input?.scopes),
            },
            client,
          })
        ),
      update: (input: Input<"apps", "update">) =>
        request(
          appsUpdate({
            body: { description: input.description, name: input.name, scope },
            client,
            path: { appId: input.appId },
          })
        ),
    },
    cliAuth: {
      verifyToken: () =>
        request(
          cliAuthVerifyToken({ body: { deployToken: agent.token }, client })
        ),
    },
    deployments: {
      create: (input: Input<"deployments", "create">) =>
        request(deploymentsCreate({ body: { ...input, scope }, client })),
      get: (input: Input<"deployments", "get">) =>
        request(
          deploymentsGet({
            body: { scopes: scopes(input.scopes) },
            client,
            path: { deploymentId: input.deploymentId },
          })
        ),
      list: (input: Input<"deployments", "list">) =>
        request(
          deploymentsList({
            body: {
              appId: input.appId,
              page: input.page,
              pageSize: input.pageSize,
              scopes: scopes(input.scopes),
            },
            client,
          })
        ),
      publish: (input: Input<"deployments", "publish">) =>
        request(
          deploymentsPublish({
            body: { rollout: input.rollout, scope },
            client,
            path: { deploymentId: input.deploymentId },
          })
        ),
    },
    preview: {
      start: (input: Input<"preview", "start">) =>
        request(
          previewStart({ body: { ...input, deployToken: agent.token }, client })
        ),
      stop: (input: Input<"preview", "stop">) =>
        request(
          previewStop({
            body: { deployToken: agent.token },
            client,
            path: { sessionId: input.sessionId },
          })
        ),
    },
  } as unknown as CliClient;
};
