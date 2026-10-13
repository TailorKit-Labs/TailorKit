import type { StandardSchemaV1 } from "@standard-schema/spec";
import { appsGet } from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";

import type { TailorKitContract } from "../schema/contract";
import type { ToolImplementations, ToolContext } from "../schema/tools";
import { flattenTools, validateToolValue } from "../schema/tools";
import { normalizeBaseUrl } from "./base-url";
import { createTailorKitServer } from "./handler";
import { normalizeTailorKitNamedScope } from "./scope";
import { createToolVerifier } from "./tool-auth";
import type {
  TailorKitServerBaseOptions,
  TailorKitHandlerOptions,
  TailorKitHostContext,
  TailorKitServerInputOptions,
} from "./types";

export type { ToolImplementations } from "../schema/tools";
export type ContractScopes<T extends TailorKitContract> = {
  [N in keyof T["scopes"]]: StandardSchemaV1.InferInput<T["scopes"][N]>;
};
const getImplementation = (tree: unknown, path: string): unknown => {
  let value = tree;
  for (const name of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, name)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[name];
  }
  return value;
};
const implementationPaths = (tree: unknown, prefix = ""): string[] => {
  if (!tree || typeof tree !== "object") {
    return [];
  }
  return Object.entries(tree).flatMap(([name, value]) =>
    typeof value === "function"
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
      typeof getImplementation(tools, path) !== "function"
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
  const server = createTailorKitServer<InternalOptions>({
    ...configuration,
    ...contract,
  } as Parameters<typeof createTailorKitServer<InternalOptions>>[0]);
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
    (configuration.projectKey
      ? { authorization: `Bearer ${configuration.projectKey}` }
      : undefined);
  const verify = createToolVerifier({ fetch: requestPlatform, platformUrl });
  const { basePath, publicOrigin } = normalizeBaseUrl(configuration.baseUrl);
  return {
    ...server,
    contract,
    // oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
    async handler(
      request: Request,
      handlerOptions: TailorKitHandlerOptions<Partial<ContractScopes<T>>>
    ) {
      if (!handlerOptions?.authenticate) {
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
          input = await request.json();
          if (
            !input ||
            typeof input.path !== "string" ||
            typeof input.requestId !== "string" ||
            !/^[0-9a-f-]{36}$/u.test(input.requestId) ||
            Object.keys(input).some(
              (k) => !["path", "input", "requestId"].includes(k)
            )
          ) {
            throw new Error("Invalid credential.");
          }
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
          const authorization = request.headers.get("authorization");
          if (!authorization?.startsWith("Bearer ")) {
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
          const headersValue = await (typeof platformHeaders === "function"
            ? platformHeaders()
            : platformHeaders);
          const installation = await appsGet({
            body: { scopes: [normalizeTailorKitNamedScope(identity.scope)] },
            client: platform,
            headers: headersValue,
            path: { appId: identity.installationId },
            throwOnError: true,
          });
          const installed =
            "data" in installation ? installation.data : installation;
          if (
            installed.id !== identity.installationId ||
            installed.projectId !== identity.projectId ||
            installed.currentDeployment?.id !== identity.deploymentId
          ) {
            throw new Error("Installation unavailable");
          }
          context = Object.freeze({
            identity,
            requestId: input.requestId,
            scope: identity.scope,
          });
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
          const implementation = getImplementation(
            tools,
            input.path
          ) as (args: { input: unknown; context: ToolContext }) => unknown;
          const result = await validateToolValue(
            declaration.definition.output,
            await implementation({ context, input: value })
          );
          return Response.json({ output: result }, { headers });
        } catch {
          return new Response("Tool execution failed", {
            headers,
            status: 500,
          });
        }
      }
      return server.handler(
        request,
        handlerOptions as Parameters<typeof server.handler>[1]
      );
    },
    mcp: {
      transport(
        optionsValue: TailorKitHostContext<Partial<ContractScopes<T>>>
      ) {
        return server.mcp.transport(optionsValue);
      },
    },
  };
};
