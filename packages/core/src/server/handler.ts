import { RPCHandler } from "@orpc/server/fetch";
import { appsRuntimeSession } from "@patchsmith/client-platform/client";
import { createClient } from "@patchsmith/client-platform/client/client/index";
import * as v from "valibot";

import type {
  NoComponentFieldCallbackConflicts,
  ViewContextHierarchy,
  SlotDefinitions,
} from "#schema/index";
import { createPatchsmithSchema } from "#schema/schema";
import type { EmptyDefinitionMap } from "#schema/shared";
import { platformAppSelector } from "#server/platform-app-selector";

import { handleBackendSession } from "./backend";
import { normalizeBaseUrl } from "./base-url";
import { handleCliAuthApprovalPage } from "./cli-auth-page";
import { createContext } from "./context";
import { createExperimental } from "./experimental";
import { listApps } from "./list-apps";
import { createMcpTransport } from "./mcp";
import { patchsmithRouter } from "./router";
import {
  selectPatchsmithScopes,
  validatePatchsmithScopeSchemas,
  validatePatchsmithScopes,
} from "./scope";
import type {
  InferPatchsmithServerTools,
  InferPatchsmithServerComponents,
  InferPatchsmithServerViews,
  InferPatchsmithServerScopes,
  PatchsmithHandlerOptions,
  PatchsmithScopes,
  PatchsmithServer,
  PatchsmithServerInputOptions,
} from "./types";
import { handleViews } from "./views";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

const defaultPlatformBaseUrl = "https://patchsmith.io/api/platform";

type AbsolutePath = `/${string}`;

const resolveReadScopes = (url: URL, availableScopes: PatchsmithScopes) => {
  try {
    const names = url.searchParams.getAll("scopes");

    if (names.length === 1 && names[0] === "") {
      return [];
    }

    return selectPatchsmithScopes(
      availableScopes,
      names.length ? names : undefined
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid scope selection.";

    return new Response(message, { status: 400 });
  }
};

export const createPatchsmithServer = <
  const TOptions extends PatchsmithServerInputOptions,
>(
  options: TOptions & {
    slots?: SlotDefinitions<
      keyof InferPatchsmithServerViews<NoInfer<TOptions>> & string
    >;
    tools?: InferPatchsmithServerTools<TOptions>;
    components: InferPatchsmithServerComponents<TOptions> &
      NoComponentFieldCallbackConflicts<
        InferPatchsmithServerComponents<TOptions>
      >;
    views?: InferPatchsmithServerViews<TOptions> &
      ViewContextHierarchy<InferPatchsmithServerViews<TOptions>>;
  }
): PatchsmithServer<
  InferPatchsmithServerComponents<TOptions>,
  InferPatchsmithServerViews<TOptions>,
  InferPatchsmithServerTools<TOptions>,
  InferPatchsmithServerScopes<TOptions>
> & {
  readonly $slots?: TOptions extends { slots: infer V }
    ? V
    : EmptyDefinitionMap;
} => {
  const configuredInstructions = v.parse(
    v.optional(v.pipe(v.string(), v.trim(), v.maxLength(32_000))),
    options.agent?.instructions
  );

  const agentInstructions =
    configuredInstructions === "" ? undefined : configuredInstructions;

  const { basePath, publicOrigin } = normalizeBaseUrl(options.baseUrl);
  const scopeSchemas = validatePatchsmithScopeSchemas(options.scopes);

  // SAFETY: The server preserves the supplied typed tool table and normalizes the route base path before constructing its handler.
  const schema = createPatchsmithSchema<
    InferPatchsmithServerComponents<TOptions>,
    InferPatchsmithServerViews<TOptions>,
    InferPatchsmithServerTools<TOptions>
  >({
    components: options.components,
    scopes: options.scopes,
    slots: options.slots,
    tools: options.tools,
    views: options.views,
  });

  const platformBaseUrl =
    options.$internal?.platformBaseUrl ?? defaultPlatformBaseUrl;

  const platform = createClient({
    baseUrl: platformBaseUrl,
    fetch: options.$internal?.platformFetch,
    responseStyle: "data",
    throwOnError: true,
  });

  const platformHeaders =
    options.$internal?.platformHeaders ??
    (options.projectKey !== undefined &&
    options.projectKey !== null &&
    options.projectKey !== ""
      ? { authorization: `Bearer ${options.projectKey}` }
      : undefined);

  const rpcHandler = new RPCHandler(patchsmithRouter);

  const mcp = createMcpTransport({
    agentInstructions,
    hostUrl: publicOrigin + basePath,
    platformHeaders,
    platformUrl: platformBaseUrl,
    scopeSchemas,
  });

  const handler = async (
    request: Request,
    handlerOptions: PatchsmithHandlerOptions<
      InferPatchsmithServerScopes<TOptions>
    >
  ) => {
    const authenticate = async ({
      request: requestValue,
    }: {
      request: Request;
    }) => {
      const hostContext = await handlerOptions.authenticate({
        request: requestValue,
      });

      if (!hostContext) {
        return null;
      }

      if (
        !isStringValue(hostContext.subjectId) ||
        !hostContext.subjectId ||
        hostContext.subjectId.length > 256
      ) {
        throw new Error("Invalid authenticated subject");
      }

      return {
        ...hostContext,
        scopes: await validatePatchsmithScopes(
          scopeSchemas,
          hostContext.scopes
        ),
      };
    };

    const url = new URL(request.url);

    if (url.pathname === `${basePath}/backend/session`) {
      return await handleBackendSession(
        request,
        authenticate,
        async (appId, scopes, subjectId) => {
          const headers = await (isFunctionValue(platformHeaders)
            ? platformHeaders()
            : platformHeaders);

          const session = await appsRuntimeSession({
            body: {
              app: platformAppSelector(appId),
              scopes: Object.entries(scopes).map(([name, value]) => ({
                name,
                value,
              })),
              subjectId,
              toolUrl: `${publicOrigin + basePath}/tools/execute`,
            },
            client: platform,
            headers,
            responseStyle: "fields",
            throwOnError: false,
          });

          if (session.data) {
            return session.data;
          }

          return Response.json(
            session.error ?? { error: "Unable to authorize the app backend" },
            {
              status: session.response?.status ?? 502,
            }
          );
        },
        publicOrigin
      );
    }

    if (url.pathname === `${basePath}/views`) {
      return await handleViews(
        await createContext({
          agentInstructions,
          authenticate,
          platform,
          platformHeaders,
          request,
          schema,
          scopeSchemas,
        }),
        publicOrigin,
        `${publicOrigin + basePath}/tools/execute`
      );
    }

    if (url.pathname === `${basePath}/schema`) {
      return Response.json(schema.serialize(options.schemaSerializer));
    }

    if (url.pathname === `${basePath}/meta`) {
      return Response.json({
        schema: schema.serialize(options.schemaSerializer),
      });
    }

    if (request.method === "GET" && url.pathname === `${basePath}/apps`) {
      const context = await createContext({
        agentInstructions,
        authenticate,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
      });

      const patchsmith = await context.authenticate({ request });

      if (!patchsmith) {
        return new Response("Unauthorized", { status: 401 });
      }

      const scopes = resolveReadScopes(url, patchsmith.scopes);

      if (scopes instanceof Response) {
        return scopes;
      }

      if (scopes.length === 0) {
        return Response.json([], { headers: { "cache-control": "no-store" } });
      }

      const items = await listApps(context, scopes, request.signal);

      return Response.json(items, { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname === `${basePath}/cli-auth/approve`) {
      const context = await createContext({
        agentInstructions,
        authenticate,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
      });

      return await handleCliAuthApprovalPage({
        authenticate: context.authenticate,
        platform: context.platform,
        platformHeaders: context.platformHeaders,
        request,
        signInPath: options.cliAuth?.signInPath,
      });
    }

    // SAFETY: The server preserves the supplied typed tool table and normalizes the route base path before constructing its handler.
    const rpcResult = await rpcHandler.handle(request, {
      context: await createContext({
        agentInstructions,
        authenticate,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
      }),
      prefix:
        /* oxlint-disable typescript/no-unsafe-type-assertion -- The server preserves the supplied typed tool table and normalizes the route base path before constructing its handler. */
        basePath as AbsolutePath,
      /* oxlint-enable typescript/no-unsafe-type-assertion */
    });

    if (rpcResult.response) {
      return rpcResult.response;
    }

    return new Response("Patchsmith route not found", { status: 404 });
  };

  return {
    $internal: { platformBaseUrl, router: patchsmithRouter, schema },
    experimental: createExperimental({
      platform,
      platformHeaders,
      scopeSchemas,
    }),
    handler,
    mcp,
  };
};
