import {
  agentChunkSchema,
  agentRunCompleteChunkSchema,
} from "@tailorkit/client-platform/agent";
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

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

type Input<
  Group extends keyof TailorKitRouterClient,
  Method extends keyof TailorKitRouterClient[Group],
> = TailorKitRouterClient[Group][Method] extends (
  ...args: infer Args
) => infer _Output
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
      isObjectValue(error) &&
      "message" in error &&
      isStringValue(error.message)
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
    const clientOptions: Parameters<typeof createTailorKitClient>[0] = {
      headers: { authorization: `Bearer ${options.token}` },
      url: options.url,
    };
    if (options.fetch) {
      clientOptions.fetch = options.fetch;
    }
    return createTailorKitClient(clientOptions);
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
  // SAFETY: The adapter reconstructs the same runtime contract, but TypeScript cannot relate the erased generic parameters across this library boundary.

  return (
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- The adapter reconstructs the same runtime contract, but TypeScript cannot relate the erased generic parameters across this library boundary. */
    {
      appAgent: {
        async *chat(
          input: Input<"appAgent", "chat">,
          optionsValue: { signal?: AbortSignal }
        ) {
          let streamError: unknown;
          let streamFailed = false;
          let done = false;
          const { stream } = await appAgentChat({
            body: { ...input, deployToken: agent.token },
            client,
            onSseError: (error) => {
              streamError = error;
              streamFailed = true;
            },
            signal: optionsValue?.signal,
            sseMaxRetryAttempts: 1,
          });
          for await (const chunk of stream) {
            const event = await agentChunkSchema.parseAsync(chunk);
            if (
              agentRunCompleteChunkSchema.safeParse(event).success ||
              event.type === "error"
            ) {
              done = true;
            }
            yield event;
          }
          optionsValue?.signal?.throwIfAborted();
          if (!done && !streamFailed) {
            throw new Error("The agent stream ended unexpectedly. Try again.");
          }
          if (streamFailed) {
            throw new Error("The app agent stream failed. Try again.", {
              cause: streamError,
            });
          }
        },
      },
      apps: {
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        create: (input: Input<"apps", "create">) =>
          request(appsCreate({ body: { ...input, scope }, client })),
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        delete: (input: Input<"apps", "delete">) =>
          request(
            appsDelete({
              body: { scope },
              client,
              path: { appId: input.appId },
            })
          ),
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        deploy: (input: Input<"apps", "deploy">) =>
          request(
            appsDeploy({
              body: { deploymentId: input.deploymentId, scope },
              client,
              path: { appId: input.appId },
            })
          ),
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        get: (input: Input<"apps", "get">) =>
          request(
            appsGet({
              body: { scopes: scopes(input.scopes) },
              client,
              path: { appId: input.appId },
            })
          ),
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
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
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
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
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        verifyToken: () =>
          request(
            cliAuthVerifyToken({ body: { deployToken: agent.token }, client })
          ),
      },
      deployments: {
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        create: (input: Input<"deployments", "create">) =>
          request(deploymentsCreate({ body: { ...input, scope }, client })),
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        get: (input: Input<"deployments", "get">) =>
          request(
            deploymentsGet({
              body: { scopes: scopes(input.scopes) },
              client,
              path: { deploymentId: input.deploymentId },
            })
          ),
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
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
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
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
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        start: (input: Input<"preview", "start">) =>
          request(
            previewStart({
              body: { ...input, deployToken: agent.token },
              client,
            })
          ),
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        stop: (input: Input<"preview", "stop">) =>
          request(
            previewStop({
              body: { deployToken: agent.token },
              client,
              path: { sessionId: input.sessionId },
            })
          ),
      },
    } as unknown as CliClient
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
  );
};
