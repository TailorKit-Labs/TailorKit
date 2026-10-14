import { RPCHandler } from "@orpc/server/fetch";
import {
  appsList,
  appsRuntimeSession,
  previewAccepted,
} from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import type {
  AppsListResponses,
  PreviewAcceptedResponses,
} from "@tailorkit/client-platform/client/types.gen";

import type {
  NoComponentFieldCallbackConflicts,
  ViewContextHierarchy,
  SlotDefinitions,
} from "#schema/index";
import { createTailorKitSchema } from "#schema/schema";

import { handleBackendSession } from "./backend";
import { normalizeBaseUrl } from "./base-url";
import { handleCliAuthApprovalPage } from "./cli-auth-page";
import { createContext } from "./context";
import { createMcpTransport } from "./mcp";
import { handlePreviewConsent, readPreviewGrantIds } from "./preview-consent";
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

const previewShareIdPattern = /^[A-Za-z0-9_-]{43}$/u;

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
    : // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
      Record<never, never>;
} => {
  const { basePath, publicOrigin } = normalizeBaseUrl(options.baseUrl);
  const scopeSchemas = validateTailorKitScopeSchemas(options.scopes);
  const previewReturnPath = options.preview?.returnPath ?? "/";
  if (
    !previewReturnPath.startsWith("/") ||
    previewReturnPath.startsWith("//") ||
    previewReturnPath.includes("\\") ||
    /[\r\n]/u.test(previewReturnPath)
  ) {
    throw new Error(
      "preview.returnPath must be a same-origin root-relative path."
    );
  }
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
    const previewPrefix = `${basePath}/preview/`;
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
              scopes: Object.entries(scopes).map(([name, value]) => ({
                name,
                value,
              })),
              subjectId,
              toolUrl: `${publicOrigin + basePath}/tools/execute`,
            },
            client: platform,
            headers,
            path: { appId },
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

    const previewShareId = url.pathname.startsWith(previewPrefix)
      ? url.pathname.slice(previewPrefix.length)
      : "";
    if (
      (request.method === "GET" || request.method === "POST") &&
      previewShareIdPattern.test(previewShareId)
    ) {
      const context = await createContext({
        authenticate,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
      });
      return await handlePreviewConsent({
        authenticate: context.authenticate,
        basePath,
        platform: context.platform,
        platformHeaders: context.platformHeaders,
        request,
        returnPath: previewReturnPath,
        shareId: previewShareId,
        signInPath: options.cliAuth?.signInPath,
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === `${basePath}/preview/metadata`
    ) {
      const context = await createContext({
        authenticate,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
      });
      const viewer = await context.authenticate({ request });
      if (!viewer) {
        return new Response("Unauthorized", { status: 401 });
      }
      const scopes = resolveReadScopes(url, viewer.scopes);
      if (scopes instanceof Response) {
        return scopes;
      }
      if (scopes.length === 0) {
        return new Response("Preview unavailable", {
          headers: { "cache-control": "no-store" },
          status: 404,
        });
      }
      const result = await previewAccepted({
        body: { grantIds: readPreviewGrantIds(request), scopes },
        client: context.platform,
        headers: context.platformHeaders,
        throwOnError: true,
      });
      const data = "data" in result ? result.data : result;
      const selected = data.items.find(
        (item) => item.preview.sessionId === url.searchParams.get("sessionId")
      );
      return selected
        ? Response.json(selected.preview, {
            headers: { "cache-control": "no-store" },
          })
        : new Response("Preview unavailable", {
            headers: { "cache-control": "no-store" },
            status: 404,
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

      const items: (AppsListResponses[200]["items"][number] & {
        preview?: PreviewAcceptedResponses[200]["items"][number]["preview"];
      })[] = [];
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
      const grantIds = readPreviewGrantIds(request);
      if (grantIds.length) {
        const result = await previewAccepted({
          body: { grantIds, scopes },
          client: context.platform,
          headers: context.platformHeaders,
          throwOnError: true,
        });
        const data = "data" in result ? result.data : result;
        const byId = new Map(items.map((item, index) => [item.id, index]));
        for (const accepted of data.items) {
          const index = byId.get(accepted.app.id);
          if (index === undefined) {
            byId.set(accepted.app.id, items.length);
            items.push({ ...accepted.app, preview: accepted.preview });
          } else {
            const existing = items[index];
            if (existing) {
              items[index] = { ...existing, preview: accepted.preview };
            }
          }
        }
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
    handler,
    mcp,
  };
};
