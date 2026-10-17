import type { StandardSchemaV1 } from "@standard-schema/spec";
import { appsGet } from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import * as v from "valibot";

import type { TailorKitContract } from "#schema/contract";
import type {
  ToolImplementations,
  ToolContext,
  ToolImplementationTree,
} from "#schema/tools";
import { flattenTools, validateToolValue } from "#schema/tools";

import { normalizeBaseUrl } from "./base-url";
import { createTailorKitServer } from "./handler";
import { normalizeTailorKitNamedScope } from "./scope";
import { createToolVerifier } from "./tool-auth";
import type {
  TailorKitServerBaseOptions,
  TailorKitHandlerOptions,
  TailorKitHostContext,
  TailorKitInstallAppOptions,
  TailorKitServerInputOptions,
} from "./types";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

export type { ToolImplementations } from "#schema/tools";
export type ContractScopes<T extends TailorKitContract> = {
  [N in keyof T["scopes"]]: StandardSchemaV1.InferInput<T["scopes"][N]>;
};
const isToolHandler = (
  value: ToolImplementationTree[string]
): value is Exclude<ToolImplementationTree[string], ToolImplementationTree> =>
  typeof value === "function";

const getImplementation = (
  tree: ToolImplementationTree | undefined,
  path: string
): ToolImplementationTree[string] | undefined => {
  let value: ToolImplementationTree[string] | undefined = tree;
  for (const name of path.split(".")) {
    if (!value || isToolHandler(value) || !Object.hasOwn(value, name)) {
      return undefined;
    }
    value = value[name];
  }
  return value;
};
const implementationPaths = (
  tree: ToolImplementationTree | undefined,
  prefix = ""
): string[] => {
  if (!tree) {
    return [];
  }
  return Object.entries(tree).flatMap(([name, value]) =>
    isFunctionValue(value)
      ? [prefix + name]
      : implementationPaths(value, `${prefix + name}.`)
  );
};
/** Bind server tools without placing their implementations in the shared contract. */
export const createServer = <const T extends TailorKitContract>(
  options: Omit<TailorKitServerBaseOptions<T["scopes"]>, "scopes"> & {
    contract: T;
  } & (keyof ToolImplementations<T["tools"], "server"> extends never
      ? { tools?: ToolImplementations<T["tools"], "server"> }
      : { tools: ToolImplementations<T["tools"], "server"> })
) => {
  const { contract, tools, ...configuration } = options;
  const declarations = flattenTools(contract.tools);
  for (const [path, leaf] of declarations) {
    if (
      leaf.kind === "server" &&
      !isFunctionValue(getImplementation(tools, path))
    ) {
      throw new Error(`Missing implementation for tool "${path}"`);
    }
  }
  for (const path of implementationPaths(tools)) {
    if (declarations.get(path)?.kind !== "server") {
      throw new Error(`Undeclared server tool "${path}"`);
    }
  }
  type InternalOptions = TailorKitServerInputOptions & {
    views: T["views"];
    slots: T["slots"];
    tools: T["tools"];
  };
  // SAFETY: The generic contract supplies the matching views, slots and tools; configuration supplies the remaining server options.
  const server = createTailorKitServer<InternalOptions>(
    /* oxlint-disable typescript/no-unsafe-type-assertion -- The generic contract supplies the matching views, slots and tools; configuration supplies the remaining server options. */
    {
      ...configuration,
      ...contract,
    } as Parameters<typeof createTailorKitServer<InternalOptions>>[0]
    /* oxlint-enable typescript/no-unsafe-type-assertion */
  );
  const platformUrl = server.$internal.platformBaseUrl;
  const requestPlatform =
    configuration.$internal?.platformFetch ?? globalThis.fetch;
  const platform = createClient({
    baseUrl: platformUrl,
    fetch: requestPlatform,
    responseStyle: "data",
    throwOnError: true,
  });
  const platformHeaders =
    configuration.$internal?.platformHeaders ??
    (configuration.projectKey !== undefined &&
    configuration.projectKey !== null &&
    configuration.projectKey !== ""
      ? { authorization: `Bearer ${configuration.projectKey}` }
      : undefined);
  const verify = createToolVerifier({ fetch: requestPlatform, platformUrl });
  const { basePath, publicOrigin } = normalizeBaseUrl(configuration.baseUrl);
  const authenticateTool = async (
    request: Request,
    requestId: string
  ): Promise<ToolContext> => {
    const authorization = request.headers.get("authorization");
    if (!(authorization?.startsWith("Bearer ") === true)) {
      throw new Error("Invalid credential.");
    }
    const identity = await verify(
      authorization.slice(7),
      `${publicOrigin + basePath}/tools/execute`
    );
    const schema = contract.scopes[identity.scope.name];
    if (!schema) {
      throw new Error("Invalid credential.");
    }
    await validateToolValue(schema, identity.scope.value);
    const headersValue = await (isFunctionValue(platformHeaders)
      ? platformHeaders()
      : platformHeaders);
    const installation = await appsGet({
      body: { scopes: [normalizeTailorKitNamedScope(identity.scope)] },
      client: platform,
      headers: headersValue,
      path: { appId: identity.installationId },
      throwOnError: true,
    });
    const installed = "data" in installation ? installation.data : installation;
    if (
      installed.id !== identity.installationId ||
      installed.projectId !== identity.projectId ||
      installed.currentDeployment?.id !== identity.deploymentId
    ) {
      throw new Error("Installation unavailable");
    }
    return Object.freeze({
      identity,
      requestId,
      scope: identity.scope,
    });
  };
  return {
    ...server,
    contract,
    experimental: {
      installApp: async (
        input: TailorKitInstallAppOptions<ContractScopes<T>>
      ) =>
        await server.experimental.installApp({
          appId: input.appId,
          scope: input.scope,
        }),
    },
    handler: async (
      request: Request,
      handlerOptions: TailorKitHandlerOptions<Partial<ContractScopes<T>>>
    ) => {
      if (
        !(
          handlerOptions?.authenticate !== undefined &&
          handlerOptions?.authenticate !== null
        )
      ) {
        throw new Error("Supply authenticate to the handler");
      }
      const url = new URL(request.url);
      if (url.pathname === `${basePath}/tools/execute`) {
        const headers = {
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        };
        if (request.method === "OPTIONS") {
          return new Response(null, { headers, status: 204 });
        }
        if (request.method !== "POST") {
          return new Response("Method not allowed", {
            headers,
            status: 405,
          });
        }
        let input: { path: string; input?: unknown; requestId: string };
        try {
          input = v.parse(
            v.strictObject({
              input: v.optional(v.unknown()),
              path: v.string(),
              requestId: v.pipe(v.string(), v.regex(/^[0-9a-f-]{36}$/u)),
            }),
            await request.json()
          );
        } catch {
          return new Response("Invalid tool request", {
            headers,
            status: 400,
          });
        }
        const declaration = declarations.get(input.path);
        if (declaration?.kind !== "server") {
          return new Response("Tool not found", { headers, status: 404 });
        }
        let context: ToolContext;
        try {
          context = await authenticateTool(request, input.requestId);
        } catch {
          return new Response("Unauthorized", { headers, status: 401 });
        }
        let value;
        try {
          value = await validateToolValue(
            declaration.definition.input,
            input.input
          );
        } catch {
          return new Response("Invalid tool input", {
            headers,
            status: 400,
          });
        }
        try {
          const implementation = getImplementation(tools, input.path);
          if (!isFunctionValue(implementation)) {
            throw new Error("Tool implementation unavailable");
          }
          // SAFETY: This registered path owns the declaration that validated value above; the heterogeneous tree erases only its specific input type.
          const toolInput =
            /* oxlint-disable typescript/no-unsafe-type-assertion -- This registered path owns the declaration that validated value above; the heterogeneous tree erases only its specific input type. */
            value as never;
          /* oxlint-enable typescript/no-unsafe-type-assertion */
          const result = await validateToolValue(
            declaration.definition.output,
            await implementation({ context, input: toolInput })
          );
          return Response.json({ output: result }, { headers });
        } catch {
          return new Response("Tool execution failed", {
            headers,
            status: 500,
          });
        }
      }
      // SAFETY: ContractScopes derives each scope input from the same contract passed to createTailorKitServer.
      return await server.handler(request, handlerOptions);
    },
    mcp: {
      transport: async (
        optionsValue: TailorKitHostContext<Partial<ContractScopes<T>>>
      ) => await server.mcp.transport(optionsValue),
    },
  };
};
