import { RPCHandler } from "@orpc/server/fetch";
import {
  appsList,
  appsRuntimeSession,
} from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import type { AppsListResponses } from "@tailorkit/client-platform/client/types.gen";

import type {
  NoComponentFieldCallbackConflicts,
  ViewContextHierarchy,
  SlotDefinitions,
} from "#schema/index";
import { createTailorKitSchema } from "#schema/schema";
import type { EmptyDefinitionMap } from "#schema/shared";
import { platformAppSelector } from "#server/platform-app-selector";

import { handleBackendSession } from "./backend";
import { normalizeBaseUrl } from "./base-url";
import { handleCliAuthApprovalPage } from "./cli-auth-page";
import { createContext } from "./context";
import { createExperimental } from "./experimental";
import { createMcpTransport } from "./mcp";
import { tailorkitRouter } from "./router";
import {
  selectTailorKitScopes,
  validateTailorKitScopeSchemas,
  validateTailorKitScopes,
} from "./scope";
import type {
  InferTailorKitServerTools,
  InferTailorKitServerComponents,
  InferTailorKitServerViews,
  InferTailorKitServerScopes,
  TailorKitHandlerOptions,
  TailorKitScopes,
  TailorKitServer,
  TailorKitServerInputOptions,
} from "./types";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

const defaultPlatformBaseUrl = "https://tailorkit.dev/api/platform";

type AbsolutePath = `/${string}`;

const resolveReadScopes = (url: URL, availableScopes: TailorKitScopes) => {
  try {
    const names = url.searchParams.getAll("scopes");
    if (names.length === 1 && names[0] === "") {
      return [];
    }
    return selectTailorKitScopes(
      availableScopes,
      names.length ? names : undefined
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid scope selection.";
    return new Response(message, { status: 400 });
  }
};

export const createTailorKitServer = <
  const TOptions extends TailorKitServerInputOptions,
>(
  options: TOptions & {
    slots?: SlotDefinitions<
      keyof InferTailorKitServerViews<NoInfer<TOptions>> & string
    >;
    tools?: InferTailorKitServerTools<TOptions>;
    components: InferTailorKitServerComponents<TOptions> &
      NoComponentFieldCallbackConflicts<
        InferTailorKitServerComponents<TOptions>
      >;
    views?: InferTailorKitServerViews<TOptions> &
      ViewContextHierarchy<InferTailorKitServerViews<TOptions>>;
  }
): TailorKitServer<
  InferTailorKitServerComponents<TOptions>,
  InferTailorKitServerViews<TOptions>,
  InferTailorKitServerTools<TOptions>,
  InferTailorKitServerScopes<TOptions>
> & {
  readonly $slots?: TOptions extends { slots: infer V }
    ? V
    : EmptyDefinitionMap;
} => {
  const { basePath, publicOrigin } = normalizeBaseUrl(options.baseUrl);
  const scopeSchemas = validateTailorKitScopeSchemas(options.scopes);
  // SAFETY: The server preserves the supplied typed tool table and normalizes the route base path before constructing its handler.
  const schema = createTailorKitSchema<
    InferTailorKitServerComponents<TOptions>,
    InferTailorKitServerViews<TOptions>,
    InferTailorKitServerTools<TOptions>
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
  const rpcHandler = new RPCHandler(tailorkitRouter);
  const mcp = createMcpTransport({
    hostUrl: publicOrigin + basePath,
    platformHeaders,
    platformUrl: platformBaseUrl,
    scopeSchemas,
  });

  // oxlint-disable-next-line complexity -- request dispatch is intentionally centralized here.
  const handler = async (
    request: Request,
    handlerOptions: TailorKitHandlerOptions<
      InferTailorKitServerScopes<TOptions>
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
        hostContext.subjectId !== undefined &&
        (!isStringValue(hostContext.subjectId) ||
          !hostContext.subjectId ||
          hostContext.subjectId.length > 256)
      ) {
        throw new Error("Invalid authenticated subject");
      }
      return {
        ...hostContext,
        scopes: await validateTailorKitScopes(scopeSchemas, hostContext.scopes),
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
        authenticate,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
      });
      const tailorkit = await context.authenticate({ request });

      if (!tailorkit) {
        return new Response("Unauthorized", { status: 401 });
      }

      const scopes = resolveReadScopes(url, tailorkit.scopes);
      if (scopes instanceof Response) {
        return scopes;
      }
      if (scopes.length === 0) {
        return Response.json([], { headers: { "cache-control": "no-store" } });
      }

      const items: AppsListResponses[200]["items"] = [];
      let page = 1;
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
        const result = await appsList({
          body: { page, pageSize: 100, scopes },
          client: context.platform,
          headers: context.platformHeaders,
          throwOnError: true,
        });
        const data = "data" in result ? result.data : result;
        items.push(...data.items);
        if (!data.pagination.hasMore) {
          break;
        }
        page += 1;
      }
      return Response.json(items, { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname === `${basePath}/cli-auth/approve`) {
      const context = await createContext({
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

    return new Response("TailorKit route not found", { status: 404 });
  };

  return {
    $internal: { platformBaseUrl, router: tailorkitRouter, schema },
    experimental: createExperimental({
      platform,
      platformHeaders,
      scopeSchemas,
    }),
    handler,
    mcp,
  };
};
